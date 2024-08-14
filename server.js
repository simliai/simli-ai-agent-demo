const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const axios = require("axios");
dotenv.config();

const app = express();
const cors = require('cors');
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const deepgramClient = createClient(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY);
let keepAlive;

const Groq = require('groq-sdk');
const groq = new Groq(process.env.GROQ_API_KEY);

// const elevenlabs_voiceid = 'JlzYwOXWcqZ7RCVOjgKn';
const elevenlabs_voiceid = 'kFsnovBBn69vNsybyS3T';

console.log("Deepgram API key:", process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ? "Set" : "Not set");
console.log("Groq API key:", process.env.GROQ_API_KEY ? "Set" : "Not set");
console.log("ElevenLabs API key:", process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY ? "Set" : "Not set");

let audioQueue = [];

async function promptLLM(ws, prompt) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          // content: `You are Boromir from Lord of the rings, and someone from the real world is calling you to talk to you about something, you start each response with "One does not simply..." and you are edgy and humerous. Your responses are not too lengthy, not verbose.`
          content: `You are Einstein and you are talking to a student who is asking you about the theory of relativity.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: "llama3-8b-8192",
      temperature: 1,
      max_tokens: 512,
      top_p: 1,
      stream: true,
      stop: null
    });

    let fullResponse = '';
    let elevenLabsWs = null;

    for await (const chunk of chatCompletion) {
      const chunkMessage = chunk.choices[0]?.delta?.content || '';
      fullResponse += chunkMessage;

      // Send the chunk to the client for real-time display
      ws.send(JSON.stringify({ type: 'text', content: chunkMessage }));

      // Start ElevenLabs streaming if it hasn't started yet
      if (!elevenLabsWs && fullResponse.length > 0) {
        elevenLabsWs = await startElevenLabsStreaming(ws);
      }

      // Send chunk to ElevenLabs if streaming has started
      if (elevenLabsWs && chunkMessage) {
        const contentMessage = {
          text: chunkMessage,
          try_trigger_generation: true,
        };
        elevenLabsWs.send(JSON.stringify(contentMessage));
      }
    }

    // Close ElevenLabs streaming
    if (elevenLabsWs) {
      elevenLabsWs.send(JSON.stringify({ text: "", try_trigger_generation: true }));
    }

  } catch (error) {
    console.error("Error in promptLLM:", error);
  }
}

async function startElevenLabsStreaming(ws) {
  return new Promise((resolve, reject) => {
    const elevenLabsWs = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${elevenlabs_voiceid}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000`);

    elevenLabsWs.on('open', () => {
      console.log('Connected to ElevenLabs WebSocket');
      
      // Send the initial message with audio settings
      const initialMessage = {
        text: " ", // Empty text to initialize the stream
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        },
        xi_api_key: process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY,
      };

      elevenLabsWs.send(JSON.stringify(initialMessage));
      resolve(elevenLabsWs);
    });

    elevenLabsWs.on('message', (data) => {
      const message = JSON.parse(data);
      if (message.audio) {
        // Log the size of the chunk in bytes
        console.log('ElevenLabs audio chunk size:', message.audio.length);
        
        // Decode base64 audio data
        const audioData = Buffer.from(message.audio, 'base64');
        
        // Chunk it up into max 16KB chunks and send to the client
        const chunkSize = 5 * 1024; // 5KB
        let i = 0;
        while (i < audioData.length) {
          const end = Math.min(i + chunkSize, audioData.length);
          const chunk = audioData.slice(i, end);
          ws.send(chunk);
          i += chunkSize;
        }
      } else if (message.isFinal) {
        console.log('ElevenLabs streaming completed');
        elevenLabsWs.close();
      }
    });

    elevenLabsWs.on('error', (error) => {
      console.error('ElevenLabs WebSocket error:', error);
      reject(error);
    });

    elevenLabsWs.on('close', () => {
      console.log('ElevenLabs WebSocket closed');
    });
  });
}

const setupDeepgram = (ws) => {
  let is_finals = [];
  const deepgram = deepgramClient.listen.live({
    model: "nova-2",
    language: "en",
    smart_format: true,
    no_delay: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000
  });

  if (keepAlive) clearInterval(keepAlive);
  keepAlive = setInterval(() => {
    deepgram.keepAlive();
  }, 10 * 1000);

  deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
    console.log("Deepgram STT: Connected");

    deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
      const transcript = data.channel.alternatives[0].transcript;
      if (transcript !== "") {
        if (data.is_final) {
          is_finals.push(transcript);
          if (data.speech_final) {
            const utterance = is_finals.join(" ");
            is_finals = [];
            console.log(`Deepgram STT: [Speech Final] ${utterance}`);
            promptLLM(ws, utterance);
          } else {
            console.log(`Deepgram STT: [Is Final] ${transcript}`);
          }
        } else {
          console.log(`Deepgram STT: [Interim Result] ${transcript}`);
        }
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.UtteranceEnd, (data) => {
      if (is_finals.length > 0) {
        console.log("Deepgram STT: [Utterance End]");
        const utterance = is_finals.join(" ");
        is_finals = [];
        console.log(`Deepgram STT: [Speech Final] ${utterance}`);
        promptLLM(ws, utterance);
      }
    });

    deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
      console.log("Deepgram STT: Disconnected");
      clearInterval(keepAlive);
      deepgram.removeAllListeners();
    });

    deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
      console.error("Deepgram STT error:", error);
    });

    // Process any queued audio data
    while (audioQueue.length > 0) {
      const audioData = audioQueue.shift();
      deepgram.send(audioData);
    }
  });

  return deepgram;
};

wss.on("connection", (ws) => {
  console.log("WebSocket: Client connected");
  let deepgram = setupDeepgram(ws);

  ws.on("message", (message) => {
    console.log("WebSocket: Client data received", typeof message, message.length, "bytes");

    if (deepgram.getReadyState() === 1) {
      console.log("WebSocket: Data sent to Deepgram");
      deepgram.send(message);
    } else {
      console.log("WebSocket: Data queued for Deepgram. Current state:", deepgram.getReadyState());
      audioQueue.push(message);
    }
  });

  ws.on("close", () => {
    console.log("WebSocket: Client disconnected");
    deepgram.removeAllListeners();
    deepgram = null;
  });
});

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});