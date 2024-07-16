import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';

let candidateCount: number = 0;

interface Props {
    faceID: string;
}

// This component is created using forwardRef to allow parent components to access its methods
const WebRTCComponent = forwardRef(({ faceID = 'tmp9i8bbq7c' }: Props, ref) => {
    // Expose the sendAudioData method to parent components
    useImperativeHandle(ref, () => ({
        sendAudioData,
        start,
    }));
    WebRTCComponent.displayName = 'WebRTCComponent';

    // Refs for various DOM elements and media objects
    const dataChannelLogRef = useRef<HTMLDivElement>(null);
    const iceConnectionLogRef = useRef<HTMLDivElement>(null);
    const iceGatheringLogRef = useRef<HTMLDivElement>(null);
    const signalingLogRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);

    // State for managing the RTCPeerConnection and RTCDataChannel
    const [pc, setPc] = useState<RTCPeerConnection | null>(null);
    const [dc, setDc] = useState<RTCDataChannel | null>(null);

    const [dcInterval, setDcInterval] = useState<number | null>(null);
    const defaultAudioInputDevice = useRef<MediaDeviceInfo | null>(null);
    const defaultVideoInputDevice = useRef<MediaDeviceInfo | null>(null);

    // Initialize the component
    useEffect(() => {
        start();
        enumerateInputDevices();
    }, []);

    // Function to send audio data through the data channel
    const sendAudioData = (audioData: Uint8Array) => {
        if (dc && dc.readyState === 'open') {
            console.log('Sending audio data to lipsync');
            dc.send(audioData);
        } else {
            console.log('Data channel is not open ' + dc?.readyState);
        }
    };

    // Create and configure the RTCPeerConnection
    const createPeerConnection = async () => {
        const config: RTCConfiguration = {};

        // Set up STUN server for NAT traversal
        config.iceServers = [{ urls: ['stun:api.simli.ai'] }];

        const newPc = new RTCPeerConnection(config);

        // Add event listeners for various connection state changes
        newPc.addEventListener('icegatheringstatechange', () => {
            // Update UI with ICE gathering state changes
        });

        newPc.addEventListener('iceconnectionstatechange', () => {
            // Update UI with ICE connection state changes
        });

        newPc.addEventListener('signalingstatechange', () => {
            // Update UI with signaling state changes
        });

        // Handle incoming media tracks
        newPc.addEventListener('track', (evt) => {
            if (evt.track.kind === 'video' && videoRef.current) {
                videoRef.current.srcObject = evt.streams[0];
            } else if (audioRef.current) {
                audioRef.current.srcObject = evt.streams[0];
            }
        });

        // Handle ICE candidates
        newPc.onicecandidate = (event) => {
            if (event.candidate === null) {
                console.log(JSON.stringify(newPc.localDescription));
            } else {
                console.log(event.candidate);
                candidateCount += 1;
            }
        };

        setPc(newPc);
        return newPc;
    };

    // Enumerate available media input devices
    const enumerateInputDevices = () => {
        navigator.mediaDevices
            .enumerateDevices()
            .then((devices) => {
                // Store default audio and video input devices
            })
            .catch((e) => {
                alert(e);
            });
    };

    // Negotiate the WebRTC connection
    const negotiate = async () => {
        if (!pc) return;
        try {
            // Create and set local description (offer)
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Wait for ICE gathering to complete
            let PreviousCandidateCount: number = -1;
            while (
                pc.iceGatheringState !== 'complete' &&
                PreviousCandidateCount !== candidateCount
            ) {
                console.log(pc.iceGatheringState, candidateCount);
                PreviousCandidateCount = candidateCount;
                await new Promise((resolve) => setTimeout(resolve, 250));
                if (PreviousCandidateCount === candidateCount) {
                    break;
                }
            }

            let localDescription = pc.localDescription;
            if (!localDescription) return;
            console.log('Local description', localDescription);

            let sdp = localDescription.sdp;

            // Create modified offer with the processed SDP
            const modifiedOffer = new RTCSessionDescription({
                type: localDescription.type,
                sdp: sdp,
            });

            // Send offer to the server and get answer
            console.log('Sending offer', modifiedOffer);
            const response = await fetch('https://api.simli.ai/StartWebRTCSession', {
                body: JSON.stringify({
                    sdp: modifiedOffer.sdp,
                    type: modifiedOffer.type,
                    video_transform: 'none',
                }),
                headers: {
                    'Content-Type': 'application/json',
                },
                method: 'POST',
            });
            console.log('Got answer');
            const answer = await response.json();

            // Set remote description (answer)
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
            alert(e);
        }
    };

    // Start the WebRTC connection process
    const start = async () => {
        console.log('Creating a new peer connection');
        const newPc = await createPeerConnection();

        let time_start: number | null = null;

        const current_stamp = () => {
          // Calculate elapsed time
        };

        // Create a data channel
        const parameters = JSON.parse('{"ordered": true}');
        const newDc = newPc.createDataChannel('chat', parameters);

        // Set up data channel event listeners
        newDc.addEventListener('close', () => {
            // Handle data channel close
        });

        newDc.addEventListener('open', async () => {
            // Handle data channel open
            // Start audio-to-video session
            const metadata = {
                faceId: faceID,
                isJPG: false,
                apiKey: process.env.NEXT_PUBLIC_SIMLI_API_KEY,
                syncAudio: true,
            };

            const response = await fetch(
                'https://api.simli.ai/startAudioToVideoSession',
                {
                    method: 'POST',
                    body: JSON.stringify(metadata),
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );
            const resJSON = await response.json();
            newDc.send(resJSON.session_token);
            console.log(resJSON);

            // Set up interval to send ping messages
            const interval = window.setInterval(() => {
                const message = 'ping ' + current_stamp();
                if (dataChannelLogRef.current) {
                    dataChannelLogRef.current.textContent += '> ' + message + '\n';
                }
                console.log('Data channel state ', newDc.readyState);
                newDc.send(message);
            }, 1000);
            setDc(newDc);
            setDcInterval(interval);
        });

        newDc.addEventListener('message', (evt) => {
            // Handle incoming messages
        });


        // Set up media constraints
        const constraints: MediaStreamConstraints = {
            audio: true,
            video: true,
        };

        // Get user media and start negotiation
        if (constraints.audio || constraints.video) {
            navigator.mediaDevices
                .getUserMedia(constraints)
                .then((stream) => {
                    stream.getTracks().forEach((track) => {
                        newPc.addTrack(track, stream);
                    });
                    return negotiate();
                })
                .catch((err) => {
                    alert('Could not acquire media: ' + err);
                });
        } else {
            negotiate();
        }

    };

    // Function to stop the WebRTC connection
    const stop = () => {
        // Close data channel and peer connection
    };

    // Helper function to escape special characters in regex
    const escapeRegExp = (string: string) => {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Render the component
    return (
        <div className='h-[512px] w-[512px]' id='media'>
            <audio id='audio' ref={audioRef} autoPlay></audio>
            <video
                className=''
                id='video'
                ref={videoRef}
                autoPlay
                playsInline
            ></video>
        </div>
    );
});

export default WebRTCComponent;