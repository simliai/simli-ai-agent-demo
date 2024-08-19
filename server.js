const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const axios = require("axios");
const url = require('url'); 
dotenv.config();

const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());
const server = http.createServer(app);

const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const deepgramClient = createClient(process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY);

const Groq = require('groq-sdk');
const groq = new Groq(process.env.GROQ_API_KEY);

console.log("Deepgram API key:", process.env.NEXT_PUBLIC_DEEPGRAM_API_KEY ? "Set" : "Not set");
console.log("Groq API key:", process.env.GROQ_API_KEY ? "Set" : "Not set");
console.log("ElevenLabs API key:", process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY ? "Set" : "Not set");

// Connection manager to keep track of active connections
const connections = new Map();

app.post('/start-conversation', (req, res) => {
  const { prompt, voiceId } = req.body;
  if (!prompt || !voiceId) {
    return res.status(400).json({ error: 'Prompt and voiceId are required' });
  }

  const connectionId = Date.now().toString();
  connections.set(connectionId, { prompt, voiceId });
  res.json({ connectionId, message: 'Conversation started. Connect to WebSocket to continue.' });
});

const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname, query } = url.parse(request.url, true);
  
  if (pathname === '/ws') {
    const connectionId = query.connectionId;
    if (!connectionId || !connections.has(connectionId)) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      const connection = connections.get(connectionId);
      console.log(`WebSocket: Client connected (ID: ${connectionId})`);
      setupWebSocket(ws, connection.prompt, connection.voiceId, connectionId);
    });
  } else {
    socket.destroy();
  }
});

function setupWebSocket(ws, initialPrompt, voiceId, connectionId) {
  let is_finals = [];
  let audioQueue = [];
  let keepAlive;

  const deepgram = deepgramClient.listen.live({
    model: "nova-2",
    language: "en",
    smart_format: true,
    no_delay: true,
    interim_results: true,
    endpointing: 300,
    utterance_end_ms: 1000
  });

  deepgram.addListener(LiveTranscriptionEvents.Open, () => {
    console.log(`Deepgram STT: Connected (ID: ${connectionId})`);
    while (audioQueue.length > 0) {
      const audioData = audioQueue.shift();
      deepgram.send(audioData);
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript !== "") {
      if (data.is_final) {
        is_finals.push(transcript);
        if (data.speech_final) {
          const utterance = is_finals.join(" ");
          is_finals = [];
          console.log(`Deepgram STT: [Speech Final] ${utterance} (ID: ${connectionId})`);
          
          promptLLM(ws, initialPrompt, utterance, voiceId, connectionId);
        } else {
          console.log(`Deepgram STT: [Is Final] ${transcript} (ID: ${connectionId})`);
        }
      } else {
        console.log(`Deepgram STT: [Interim Result] ${transcript} (ID: ${connectionId})`);
      }
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.UtteranceEnd, () => {
    if (is_finals.length > 0) {
      const utterance = is_finals.join(" ");
      is_finals = [];
      console.log(`Deepgram STT: [Speech Final] ${utterance} (ID: ${connectionId})`);
      promptLLM(ws, utterance, voiceId, connectionId);
    }
  });

  deepgram.addListener(LiveTranscriptionEvents.Close, () => {
    console.log(`Deepgram STT: Disconnected (ID: ${connectionId})`);
    clearInterval(keepAlive);
    deepgram.removeAllListeners();
  });

  deepgram.addListener(LiveTranscriptionEvents.Error, (error) => {
    console.error(`Deepgram STT error (ID: ${connectionId}):`, error);
  });

  ws.on("message", (message) => {
    console.log(`WebSocket: Client data received (ID: ${connectionId})`, typeof message, message.length, "bytes");

    if (deepgram.getReadyState() === 1) {
      deepgram.send(message);
    } else {
      console.log(`WebSocket: Data queued for Deepgram. Current state: ${deepgram.getReadyState()} (ID: ${connectionId})`);
      audioQueue.push(message);
    }
  });

  ws.on("close", () => {
    console.log(`WebSocket: Client disconnected (ID: ${connectionId})`);
    clearInterval(keepAlive);
    deepgram.removeAllListeners();
    connections.delete(connectionId);
  });

  keepAlive = setInterval(() => {
    deepgram.keepAlive();
  }, 10 * 1000);

  connections.set(connectionId, { ...connections.get(connectionId), ws, deepgram });
}

async function promptLLM(ws,initialPrompt, prompt, voiceId, connectionId) {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: initialPrompt
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: "llama3-8b-8192",
      temperature: 1,
      max_tokens: 50,
      top_p: 1,
      stream: true,
      stop: null
    });

    let fullResponse = '';
    let elevenLabsWs = null;

    for await (const chunk of chatCompletion) {
      if (!connections.has(connectionId)) {
        console.log(`LLM process stopped: Connection ${connectionId} no longer exists`);
        break;
      }

      const chunkMessage = chunk.choices[0]?.delta?.content || '';
      fullResponse += chunkMessage;

      ws.send(JSON.stringify({ type: 'text', content: chunkMessage }));

      if (!elevenLabsWs && fullResponse.length > 0) {
        elevenLabsWs = await startElevenLabsStreaming(ws, voiceId, connectionId);
      }

      if (elevenLabsWs && chunkMessage) {
        const contentMessage = {
          text: chunkMessage,
          try_trigger_generation: true,
        };
        elevenLabsWs.send(JSON.stringify(contentMessage));
      }
    }

    if (elevenLabsWs) {
      elevenLabsWs.send(JSON.stringify({ text: "", try_trigger_generation: true }));
    }

  } catch (error) {
    console.error(`Error in promptLLM (ID: ${connectionId}):`, error);
  }
}

async function startElevenLabsStreaming(ws, voiceId, connectionId) {
  return new Promise((resolve, reject) => {
    const elevenLabsWs = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000`);

    elevenLabsWs.on('open', () => {
      console.log(`Connected to ElevenLabs WebSocket (ID: ${connectionId})`);
      const initialMessage = {
        text: " ", 
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
      if (!connections.has(connectionId)) {
        console.log(`ElevenLabs process stopped: Connection ${connectionId} no longer exists`);
        elevenLabsWs.close();
        return;
      }

      const message = JSON.parse(data);
      if (message.audio) {
        const audioData = Buffer.from(message.audio, 'base64');
        const chunkSize = 5 * 1024; // 5KB
        let i = 0;
        while (i < audioData.length) {
          const end = Math.min(i + chunkSize, audioData.length);
          const chunk = audioData.slice(i, end);
          ws.send(chunk);
          i += chunkSize;
        }
      } else if (message.isFinal) {
        console.log(`ElevenLabs streaming completed (ID: ${connectionId})`);
        elevenLabsWs.close();
      }
    });

    elevenLabsWs.on('error', (error) => {
      console.error(`ElevenLabs WebSocket error (ID: ${connectionId}):`, error);
      reject(error);
    });

    elevenLabsWs.on('close', () => {
      console.log(`ElevenLabs WebSocket closed (ID: ${connectionId})`);
    });
  });
}

const port = 8080;
server.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});