'use client';
import React, { useState, useRef, useEffect } from 'react';
import { SimliClient } from 'simli-client';

// const simli_faceid = '59da7c39-3de9-493b-b6e8-c53906f30ae0';
const simli_faceid = '647df045-c29e-47f2-858d-1b86bdd018fd';

const Demo = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatgptText, setChatgptText] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const simliClientRef = useRef<SimliClient | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const accumulatedBuffersRef = useRef<Float32Array[]>([]);
  const textAreaRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && audioRef.current) {
      // Initialize Simli Client
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
  
      // Initialize WebSocket connection
      socketRef.current = new WebSocket('ws://localhost:8080');
  
      socketRef.current.onopen = () => {
        console.log('Connected to server');
      };
  
      socketRef.current.onmessage = (event) => {
        if (event.data instanceof Blob) {
          // Handle audio data from server
          event.data.arrayBuffer().then((arrayBuffer) => {
            const uint8Array = new Uint8Array(arrayBuffer);
            simliClientRef.current?.sendAudioData(uint8Array);
          });
        } else {
          // Handle text messages from server
          try {
            const message = JSON.parse(event.data);
            if (message.type === 'text') {
              setChatgptText(prev => prev + message.content);
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
    }
  
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (simliClientRef.current) {
        simliClientRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    // Scroll to the bottom of the text area when new text is added
    if (textAreaRef.current) {
      textAreaRef.current.scrollTop = textAreaRef.current.scrollHeight;
    }
  }, [chatgptText]);

  const playAccumulatedBuffers = () => {
    if (!audioContextRef.current || accumulatedBuffersRef.current.length === 0) return;

    const totalLength = accumulatedBuffersRef.current.reduce((acc, buffer) => acc + buffer.length, 0);
    const combinedBuffer = audioContextRef.current.createBuffer(1, totalLength, audioContextRef.current.sampleRate);
    const channelData = combinedBuffer.getChannelData(0);

    let offset = 0;
    for (const buffer of accumulatedBuffersRef.current) {
      channelData.set(buffer, offset);
      offset += buffer.length;
    }

    sourceNodeRef.current = audioContextRef.current.createBufferSource();
    sourceNodeRef.current.buffer = combinedBuffer;
    sourceNodeRef.current.connect(audioContextRef.current.destination);
    sourceNodeRef.current.start();

    sourceNodeRef.current.onended = () => {
      accumulatedBuffersRef.current = [];
      playAccumulatedBuffers();
    };

    // Send audio data to Simli Client
    const int16Data = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      int16Data[i] = Math.max(-32768, Math.min(32767, Math.floor(channelData[i] * 32768)));
    }
    simliClientRef.current?.sendAudioData(new Uint8Array(int16Data.buffer));
  };

  const handleStart = () => {
    simliClientRef.current?.start();
    setStartWebRTC(true);

    setTimeout(() => {
      const audioData = new Uint8Array(6000).fill(0);
      simliClientRef.current?.sendAudioData(audioData);
    }, 4000);
  };

  const startRecording = async () => {
    console.log('Starting recording...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(event.data);
        }
      };

      mediaRecorder.start(100); // Collect 250ms of audio data at a time

      setIsRecording(true);
      console.log('Recording started');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Error accessing microphone. Please check your permissions.');
    }
  };

  const stopRecording = () => {
    console.log('Stopping recording...');
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setIsRecording(false);
    console.log('Recording stopped');
  };

return (
    <div className="bg-black w-full h-svh flex flex-col justify-center items-center font-mono text-white">
      <div className="w-[512px] h-svh flex flex-col justify-center items-center gap-4">
        <div className="relative w-full aspect-video">
          <video ref={videoRef} id="simli_video" autoPlay playsInline className="w-full h-full object-cover"></video>
          <audio ref={audioRef} id="simli_audio" autoPlay ></audio>
        </div>
        {startWebRTC ? (
          <>
            <div 
              ref={textAreaRef}
              className="w-full h-32 bg-black-800 text-white p-2 overflow-y-auto"
            >
              {chatgptText}
            </div>
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              disabled={isLoading}
              className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50"
            >
              {isRecording ? 'Recording...' : (isLoading ? 'Processing...' : 'Push to Speak')}
            </button>
          </>
        ) : (
          <button
            onClick={handleStart}
            className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
          >
            Start WebRTC
          </button>
        )}
        {error && <p className="mt-4 text-red-500">{error}</p>}
      </div>
    </div>
  );
};

export default Demo;