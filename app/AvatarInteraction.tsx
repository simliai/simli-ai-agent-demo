import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SimliClient } from 'simli-client';

interface AvatarInteractionProps {
  simli_faceid: string;
  elevenlabs_voiceid: string;
  initialPrompt: string;
  chatgptText: string;
  onChatGPTTextChange: (text: string) => void;
  audioStream: MediaStream | null;
}

const AvatarInteraction: React.FC<AvatarInteractionProps> = ({ 
  simli_faceid, 
  elevenlabs_voiceid,
  initialPrompt,
  chatgptText,
  onChatGPTTextChange,
  audioStream
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const simliClientRef = useRef<SimliClient | null>(null);
  const textAreaRef = useRef<HTMLDivElement>(null);

  const initializeSimliClient = useCallback(() => {
    if (videoRef.current && audioRef.current) {
      const SimliConfig = {
        apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
        faceID: simli_faceid,
        handleSilence: true,
        videoRef: videoRef,
        audioRef: audioRef,
      };
  
      simliClientRef.current = new SimliClient();
      simliClientRef.current.Initialize(SimliConfig);
      console.log('Simli Client initialized');
    }
  }, [simli_faceid]);

  const startConversation = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:8080/start-conversation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: initialPrompt, 
          voiceId: elevenlabs_voiceid 
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to start conversation');
      }

      const data = await response.json();
      console.log(data.message);
      setConnectionId(data.connectionId);

      // After successful response, connect to WebSocket
      initializeWebSocket(data.connectionId);
    } catch (error) {
      console.error('Error starting conversation:', error);
      setError('Failed to start conversation. Please try again.');
    }
  }, [initialPrompt, elevenlabs_voiceid]);

  const initializeWebSocket = useCallback((connectionId: string) => {
    socketRef.current = new WebSocket(`ws://localhost:8080/ws?connectionId=${connectionId}`);
  
    socketRef.current.onopen = () => {
      console.log('Connected to server');
    };
  
    socketRef.current.onmessage = (event) => {
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((arrayBuffer) => {
          const uint8Array = new Uint8Array(arrayBuffer);
          simliClientRef.current?.sendAudioData(uint8Array);
        });
      } else {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'text') {
            console.log('Received text message:', message.content);
            onChatGPTTextChange(prevText => prevText + message.content);
          }
        } catch (error) {
          console.error('Error parsing message:', error);
        }
      }
    };
  
    socketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError('WebSocket connection error. Please check if the server is running.');
    };
  }, [onChatGPTTextChange]);

  const isWebRTCConnected = useCallback(() => {
    if (!simliClientRef.current) return false;
    
    // Access the private properties of SimliClient
    // Note: This is not ideal and breaks encapsulation, but it avoids modifying SimliClient
    const pc = (simliClientRef.current as any).pc as RTCPeerConnection | null;
    const dc = (simliClientRef.current as any).dc as RTCDataChannel | null;
    
    return pc !== null && 
           pc.iceConnectionState === 'connected' && 
           dc !== null && 
           dc.readyState === 'open';
  }, []);

  const handleStart = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      await startConversation();
      console.log('Starting WebRTC');
      simliClientRef.current?.start();
      setStartWebRTC(true);

      // Wait for the WebRTC connection to be established
      const checkConnection = async () => {
        if (isWebRTCConnected()) {
          console.log('WebRTC connection established');
          const audioData = new Uint8Array(6000).fill(0);
          simliClientRef.current?.sendAudioData(audioData);
          console.log('Sent initial audio data');
        } else {
          console.log('Waiting for WebRTC connection...');
          setTimeout(checkConnection, 1000);  // Check again after 1 second
        }
      };

      setTimeout(checkConnection, 4000);  // Start checking after 4 seconds
    } catch (error) {
      console.error('Error starting conversation:', error);
      setError('Failed to start conversation. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [startConversation, isWebRTCConnected]);

  useEffect(() => {
    initializeSimliClient();
  
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (simliClientRef.current) {
        simliClientRef.current.close();
      }
    };
  }, [initializeSimliClient]);

  useEffect(() => {
    if (textAreaRef.current) {
      textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
    }
  }, [chatgptText]);

  useEffect(() => {
    if (audioStream && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const mediaRecorder = new MediaRecorder(audioStream);
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          socketRef.current?.send(event.data);
        }
      };

      mediaRecorder.start(100);

      return () => {
        mediaRecorder.stop();
      };
    }
  }, [audioStream]);

  return (
    <>
      <div className="relative w-full aspect-video">
        <video ref={videoRef} id="simli_video" autoPlay playsInline className="w-full h-full object-cover"></video>
        <audio ref={audioRef} id="simli_audio" autoPlay ></audio>
      </div>
      {startWebRTC ? (
        <div 
          ref={textAreaRef}
          className="w-full h-32 bg-black-800 text-white p-2 overflow-y-auto"
        >
          {chatgptText}
        </div>
      ) : (
        <button
          onClick={handleStart}
          disabled={isLoading}
          className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {isLoading ? 'Starting...' : 'Start Conversation'}
        </button>
      )}
      {error && <p className="mt-4 text-red-500">{error}</p>}
    </>
  );
};

export default AvatarInteraction;