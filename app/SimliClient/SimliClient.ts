export class SimliClient {
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private dcInterval: NodeJS.Timeout | null = null;
    private candidateCount: number = 0;
    private prevCandidateCount: number = -1;
    private videoRef: React.RefObject<HTMLVideoElement> | null = null;
    private audioRef: React.RefObject<HTMLAudioElement> | null = null;

    constructor(
        private apiKey: string,
        private faceID: string,
        private handleSilence: boolean,
        videoRef: React.RefObject<HTMLVideoElement>,
        audioRef: React.RefObject<HTMLAudioElement>
    ) {
        if (typeof window !== 'undefined') {
            this.videoRef = videoRef;
            this.audioRef = audioRef;
        } else {
            console.warn('Running in Node.js environment. Some features may not be available.');
        }
    }

    private createPeerConnection() {
        const config: RTCConfiguration = {
            iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
        };

        this.pc = new window.RTCPeerConnection(config);

        if (this.pc) {
            this.setupPeerConnectionListeners();
        }
    }

    private setupPeerConnectionListeners() {
        if (!this.pc) return;

        this.pc.addEventListener('icegatheringstatechange', () => {
            console.log("ICE gathering state changed: ", this.pc?.iceGatheringState);
        });

        this.pc.addEventListener('iceconnectionstatechange', () => {
            console.log("ICE connection state changed: ", this.pc?.iceConnectionState);
        });

        this.pc.addEventListener('signalingstatechange', () => {
            console.log("Signaling state changed: ", this.pc?.signalingState);
        });

        this.pc.addEventListener('track', (evt) => {
            console.log("Track event: ", evt.track.kind);
            if (evt.track.kind === 'video' && this.videoRef?.current) {
                this.videoRef.current.srcObject = evt.streams[0];
            } else if (evt.track.kind === 'audio' && this.audioRef?.current) {
                this.audioRef.current.srcObject = evt.streams[0];
            }
        });

        this.pc.onicecandidate = (event) => {
            if (event.candidate === null) {
                console.log(JSON.stringify(this.pc?.localDescription));
            } else {
                console.log(event.candidate);
                this.candidateCount += 1;
            }
        };
    }

    async start() {
        await this.createPeerConnection();
        
        const parameters = { ordered: true };
        this.dc = this.pc!.createDataChannel('chat', parameters);

        this.setupDataChannelListeners();

        await this.getUserMedia();
        await this.negotiate();
    }

    private setupDataChannelListeners() {
        if (!this.dc) return;

        this.dc.addEventListener('close', () => {
            console.log("Data channel closed");
        });

        this.dc.addEventListener('open', async () => {
            console.log("Data channel opened");
            await this.initializeSession();

            this.dcInterval = setInterval(() => {
                const message = 'ping ' + Date.now();
                console.log('Sending: ' + message);
                this.dc?.send(message);
            }, 1000);
        });

        this.dc.addEventListener('message', (evt) => {
            console.log("Received message: ", evt.data);
        });
    }

    private async initializeSession() {
        const metadata = {
            faceId: this.faceID,
            isJPG: false,
            apiKey: this.apiKey,
            syncAudio: true,
            handleSilence: this.handleSilence,
        };

        try {
            const response = await fetch("https://api.simli.ai/startAudioToVideoSession", {
                method: "POST",
                body: JSON.stringify(metadata),
                headers: {
                    "Content-Type": "application/json",
                },
            });

            const resJSON = await response.json();
            this.dc?.send(resJSON.session_token);
        } catch (error) {
            console.error("Failed to initialize session:", error);
        }
    }

    private async getUserMedia() {
        const constraints: MediaStreamConstraints = {
            audio: true,
            video: true,
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            stream.getTracks().forEach((track) => {
                this.pc?.addTrack(track, stream);
            });
        } catch (err) {
            console.error('Could not acquire media:', err);
        }
    }

    private async negotiate() {
        if (!this.pc) {
            throw new Error("PeerConnection not initialized");
        }

        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            
            await this.waitForIceGathering();

            const localDescription = this.pc.localDescription;
            if (!localDescription) return;

            const response = await fetch("https://api.simli.ai/StartWebRTCSession", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sdp: localDescription.sdp,
                    type: localDescription.type,
                    video_transform: "none",
                }),
            });

            const answer = await response.json();
            await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
            console.error("Negotiation failed:", e);
        }
    }

    private async waitForIceGathering(): Promise<void> {
        if (!this.pc) return;

        if (this.pc.iceGatheringState === 'complete') {
            return;
        }

        await new Promise<void>((resolve) => {
            const checkState = () => {
                if (this.pc?.iceGatheringState === 'complete') {
                    this.pc.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                }
            }
            this.pc.addEventListener('icegatheringstatechange', checkState);
        });
    }

    sendAudioData(audioData: Uint8Array) {
        if (this.dc && this.dc.readyState === "open") {
            this.dc.send(audioData);
        } else {
            console.error("Data channel is not open");
        }
    }

    close() {
        if (this.dc) {
            this.dc.close();
        }

        if (this.pc) {
            this.pc.close();
        }

        if (this.dcInterval) {
            clearInterval(this.dcInterval);
        }
    }
}