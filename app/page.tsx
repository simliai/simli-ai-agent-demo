'use client';
import React, { useState, useRef, use, useEffect } from 'react';
import axios from 'axios';
import WebRTCComponent from './WebRTC/webRTC';

const simli_faceid = '5514e24d-6086-46a3-ace4-6a7264e5cb7c';
const elevenlabs_voiceid = 'onwK4e9ZLuTAKqWW03F9';

interface simliWebRTC {
  start: () => void;
  sendAudioData: (audioData: Uint8Array) => void;
}

const Demo = () => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [chatgptText, setChatgptText] = useState('');
  const [startWebRTC, setStartWebRTC] = useState(false);
  const webRTC = useRef<simliWebRTC>(null);
  const audioContext = useRef<AudioContext | null>(null);

  useEffect(() => {
    audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      if (audioContext.current) {
        audioContext.current.close();
      }
    };
  }, []);

  const handleStart = () => {
    // Step 1: Start WebRTC
    webRTC.current?.start();

    setTimeout(() => {
      // Step 2: Send empty audio data to WebRTC to start rendering
      const audioData = new Uint8Array(6000).fill(0);
      webRTC.current?.sendAudioData(audioData);
      setStartWebRTC(true);
    }, 4000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInputText('');
    setIsLoading(true);
    setError('');

    try {
      // Step 3: Send text to OpenAI ChatGPT
      const chatGPTResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: inputText }],
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const chatGPTText = chatGPTResponse.data.choices[0].message.content;
      setChatgptText(chatGPTText);

      // Step 4: Convert ChatGPT response to speech using ElevenLabs API
      const elevenlabsResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${elevenlabs_voiceid}?output_format=pcm_16000`,
        {
          text: chatGPTText,
          model_id: 'eleven_multilingual_v1'
        },
        {
          headers: {
            'xi-api-key': `${process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      // Step 5: Convert audio to Uint8Array (Make sure its of type PCM16)
      const pcm16Data = new Uint8Array(elevenlabsResponse.data);
      console.log(pcm16Data);

      // Step 6: Send audio data to WebRTC as 6000 byte chunks
      const chunkSize = 6000;
      for (let i = 0; i < pcm16Data.length; i += chunkSize) {
        const chunk = pcm16Data.slice(i, i + chunkSize);
        webRTC.current?.sendAudioData(chunk);
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-black w-full h-svh flex flex-col justify-center items-center font-mono text-white">
      <div className="w-[512px] h-svh flex flex-col justify-center items-center gap-4">
        <WebRTCComponent ref={webRTC} faceID={simli_faceid} />
        {startWebRTC ? (
          <>
            {chatgptText && <p>{chatgptText}</p>}
            <form onSubmit={handleSubmit} className="space-y-4 w-full">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Enter your message"
                className="w-full px-3 py-2 border border-white bg-black text-white focus:outline-none focus:ring-2 focus:ring-white"
              />
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-white text-black py-2 px-4 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black disabled:opacity-50"
              >
                {isLoading ? 'Processing...' : 'Send'}
              </button>
            </form>
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