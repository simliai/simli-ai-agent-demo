import React from 'react';
import Image from 'next/image';
import { Avatar } from './types'; // Assume we've moved the Avatar interface to a separate types file

interface CharacterCardProps {
  avatar: Avatar;
  onSelect: (avatar: Avatar) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({ avatar, onSelect }) => {
  return (
    <div 
      className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:scale-105 cursor-pointer"
      onClick={() => onSelect(avatar)}
    >
      <div className="relative h-48 w-full">
        <Image 
          src={avatar.imageUrl} 
          alt={avatar.name} 
          layout="fill"
          objectFit="cover"
          className="transition-opacity duration-300 hover:opacity-90"
        />
      </div>
      <div className="p-4">
        <h3 className="text-xl font-bold text-white mb-2">{avatar.name}</h3>
        <p className="text-gray-300 text-sm truncate">{avatar.initialPrompt}</p>
        <div className="mt-4 flex justify-between items-center">
          <span className="text-xs text-gray-400">Click to start conversation</span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </div>
      </div>
    </div>
  );
};

export default CharacterCard;