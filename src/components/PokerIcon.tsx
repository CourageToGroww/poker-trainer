// Generated Icon Component
// Replace emojis with these icon images

import React from 'react';

interface IconProps {
  name: string;
  className?: string;
  size?: number;
}

const iconMap: Record<string, string> = {
  practice: '/icons/practice-icon.png',
  fullgame: '/icons/fullgame-icon.png',
  tutorial: '/icons/tutorial-icon.png',
  interactive: '/icons/interactive-icon.png',
  cards: '/icons/cards-icon.png',
  chips: '/icons/chips-icon.png',
  winner: '/icons/winner-icon.png',
  fold: '/icons/fold-icon.png',
  check: '/icons/check-icon.png',
  raise: '/icons/raise-icon.png',
  allin: '/icons/allin-icon.png',
  position: '/icons/position-icon.png',
};

export const PokerIcon: React.FC<IconProps> = ({ name, className = '', size = 24 }) => {
  const src = iconMap[name];

  if (!src) {
    console.warn(`Icon not found: ${name}`);
    return null;
  }

  return (
    <img
      src={src}
      alt={name}
      className={className}
      style={{ width: size, height: size }}
    />
  );
};

// Usage examples:
// <PokerIcon name="practice" size={24} />
// <PokerIcon name="tutorial" className="inline-block mr-2" />

export default PokerIcon;
