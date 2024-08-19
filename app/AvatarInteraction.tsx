import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SimliClient } from 'simli-client';

interface AvatarInteractionProps {
  simli_faceid: string;
  chatgptText: string;
  onChatGPTTextChange: (text: string) => void;
  audioStream: MediaStream | null;
}

const AvatarInteraction: React.FC<AvatarInteractionProps> = ({ 
  simli_faceid, 
  chatgptText,
  onChatGPTTextChange,
  audioStream
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
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

  const initializeWebSocket = useCallback(() => {
    socketRef.current = new WebSocket('ws://localhost:8080');
  
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
      // setError('WebSocket connection error. Please check if the server is running.');
    };
  }, [onChatGPTTextChange]);

  useEffect(() => {
    initializeSimliClient();
    initializeWebSocket();
  
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (simliClientRef.current) {
        simliClientRef.current.close();
      }
    };
  }, [initializeSimliClient, initializeWebSocket]);

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

  const handleStart = useCallback(() => {
    console.log('Starting WebRTC');
    simliClientRef.current?.start();
    setStartWebRTC(true);

    setTimeout(() => {
      const audioData = new Uint8Array(6000).fill(0);
      simliClientRef.current?.sendAudioData(audioData);
      console.log('Sent initial audio data');
    }, 4000);
  }, []);

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
          className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
        >
          Start WebRTC
        </button>
      )}
      {error && <p className="mt-4 text-red-500">{error}</p>}
    </>
  );
};

export default AvatarInteraction;