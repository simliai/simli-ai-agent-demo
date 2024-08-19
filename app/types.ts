// types.ts

export interface Avatar {
    name: string;
    simli_faceid: string;
    elevenlabs_voiceid: string;
    initialPrompt: string;
    imageUrl: string;
  }
  
  // You can add more types here as needed for your application
  
  export interface AvatarInteractionProps {
    simli_faceid: string;
    elevenlabs_voiceid: string;
    initialPrompt: string;
    chatgptText: string;
    onChatGPTTextChange: (newText: string) => void;
    audioStream: MediaStream | null;
  }
  
  export interface CharacterCardProps {
    avatar: Avatar;
    onSelect: (avatar: Avatar) => void;
  }