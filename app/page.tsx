'use client';
import React, { useState, useCallback, useRef } from 'react';
import AvatarInteraction from './AvatarInteraction';

const simli_faceid = 'd3376e76-8830-4b86-84d0-86f25332c92e';

const Demo = () => {
  const [error, setError] = useState('');
  const [chatgptText, setChatgptText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [chatgptText2, setChatgptText2] = useState('');
  const [isRecording2, setIsRecording2] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [audioStream2, setAudioStream2] = useState<MediaStream | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaRecorderRef2 = useRef<MediaRecorder | null>(null);

  const handleChatGPTTextChange = useCallback((newText: string) => {
    console.log('Updating chatgptText:', newText);
    setChatgptText(newText);
  }, []);

  const startRecording = useCallback(async (setRecordingState: React.Dispatch<React.SetStateAction<boolean>>, setStream: React.Dispatch<React.SetStateAction<MediaStream | null>>) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(stream);
      setRecordingState(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Error accessing microphone. Please check your permissions.');
    }
  }, []);

  const stopRecording = useCallback((setRecordingState: React.Dispatch<React.SetStateAction<boolean>>, setStream: React.Dispatch<React.SetStateAction<MediaStream | null>>) => {
    setRecordingState(false);
    setStream(null);
  }, []);

  return (
    <div className="bg-black w-full h-svh flex flex-col justify-center items-center font-mono text-white">
      <div className="w-[512px] h-svh flex flex-col justify-center items-center gap-4">
        <AvatarInteraction 
          simli_faceid={simli_faceid}
          chatgptText={chatgptText}
          onChatGPTTextChange={handleChatGPTTextChange}
          audioStream={audioStream}
        />
        <button
          onMouseDown={() => startRecording(setIsRecording, setAudioStream)}
          onMouseUp={() => stopRecording(setIsRecording, setAudioStream)}
          onTouchStart={() => startRecording(setIsRecording, setAudioStream)}
          onTouchEnd={() => stopRecording(setIsRecording, setAudioStream)}
          className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black"
        >
          {isRecording ? 'Recording...' : 'Push to Speak'}
        </button>
      </div>
      {error && <p className="mt-4 text-red-500">{error}</p>}
    </div>
  );
};

export default Demo;