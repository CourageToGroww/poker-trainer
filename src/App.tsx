import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// --- Icon Component ---
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

const PokerIcon: React.FC<{ name: string; className?: string; size?: number }> = ({
  name,
  className = '',
  size = 24
}) => {
  const src = iconMap[name];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={name}
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
    />
  );
};

// --- Types & Interfaces ---

type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'all-in';
type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'MP' | 'HJ' | 'CO';

interface Card {
  rank: Rank;
  suit: Suit;
  hidden?: boolean;
}

interface Player {
  id: string;
  name: string;
  chips: number;
  position: number;
  positionName: Position;
  cards: Card[];
  isActive: boolean;
  isDealer: boolean;
  isFolded: boolean;
  currentBet: number;
  hasActed: boolean;
}

interface GameState {
  pot: number;
  communityCards: Card[];
  street: Street;
  currentBet: number;
  minRaise: number;
  deck: Card[];
}

interface ActionLogEntry {
  message: string;
  playerPosition: Position;
  action: ActionType;
  amount?: number;
  optimalAction?: string;
  handStrength?: number;
}

// --- Opponent Tracking System ---

interface PlayerStats {
  oddsPlayedPreflop: number;  // VPIP - Voluntarily Put $ In Pot
  handsPlayed: number;
  preflopRaises: number;      // PFR - Preflop Raise %
  aggression: number;         // AF - Aggression Factor (bets+raises / calls)
  bets: number;
  raises: number;
  calls: number;
  folds: number;
  foldToCBet: number;         // Fold to continuation bet %
  cBetFaced: number;
  threeBets: number;          // 3-bet frequency
  threeBetOpportunities: number;
  showdownsWon: number;
  showdownsTotal: number;
  avgBetSize: number;         // Average bet size as % of pot
  totalBetAmount: number;
  betCount: number;
}

interface BoardTexture {
  wetness: number;            // 0-100, how draw-heavy
  connectedness: number;      // 0-100, straight draw potential
  pairedness: number;         // 0 = unpaired, 1 = paired, 2 = trips
  suitedness: number;         // 0-3, number of same suit
  highCard: number;           // Highest card rank value
  lowCard: number;            // Lowest card rank value
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  isMonotone: boolean;        // All same suit
  isRainbow: boolean;         // All different suits
}

interface DrawEquity {
  flushOuts: number;
  straightOuts: number;
  totalOuts: number;
  equity: number;             // Approximate % to improve
  impliedOdds: number;        // Adjusted for future betting
}

// Initialize empty stats for a player
const createEmptyStats = (): PlayerStats => ({
  handsPlayed: 0,
  oddsPlayedPreflop: 0,
  preflopRaises: 0,
  aggression: 1,
  bets: 0,
  raises: 0,
  calls: 0,
  folds: 0,
  foldToCBet: 0,
  cBetFaced: 0,
  threeBets: 0,
  threeBetOpportunities: 0,
  showdownsWon: 0,
  showdownsTotal: 0,
  avgBetSize: 0.6,
  totalBetAmount: 0,
  betCount: 0,
});

// Analyze board texture
const analyzeBoardTexture = (communityCards: Card[]): BoardTexture => {
  if (communityCards.length === 0) {
    return {
      wetness: 50, connectedness: 50, pairedness: 0, suitedness: 0,
      highCard: 0, lowCard: 0, hasFlushDraw: false, hasStraightDraw: false,
      isMonotone: false, isRainbow: true,
    };
  }

  const ranks = communityCards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = communityCards.map(c => c.suit);
  const suitCounts: Record<string, number> = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  const maxSuitCount = Math.max(...Object.values(suitCounts));

  // Check for pairs
  const rankCounts: Record<number, number> = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const maxRankCount = Math.max(...Object.values(rankCounts));
  const pairedness = maxRankCount - 1;

  // Check connectedness (gaps between cards)
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  let connectedness = 0;
  for (let i = 0; i < uniqueRanks.length - 1; i++) {
    const gap = uniqueRanks[i + 1] - uniqueRanks[i];
    if (gap <= 2) connectedness += (3 - gap) * 20;
  }
  // Check for wheel potential (A-2-3-4-5)
  if (uniqueRanks.includes(14) && uniqueRanks.some(r => r <= 5)) {
    connectedness += 15;
  }
  connectedness = Math.min(100, connectedness);

  // Wetness = flush draws + straight draws
  const hasFlushDraw = maxSuitCount >= 2;
  const hasStraightDraw = connectedness >= 30;
  let wetness = hasFlushDraw ? 10 : 0;
  wetness += hasStraightDraw ? 10 : 0;
  if (maxSuitCount >= 3) wetness += 50;
  else if (maxSuitCount === 2) wetness += 25;
  wetness += connectedness * 0.5;
  if (pairedness > 0) wetness -= 20; // Paired boards are drier
  wetness = Math.max(0, Math.min(100, wetness));

  return {
    wetness,
    connectedness,
    pairedness,
    suitedness: maxSuitCount,
    highCard: ranks[0] || 0,
    lowCard: ranks[ranks.length - 1] || 0,
    hasFlushDraw: maxSuitCount >= 2,
    hasStraightDraw: connectedness >= 30,
    isMonotone: maxSuitCount >= 3,
    isRainbow: Object.keys(suitCounts).length === communityCards.length,
  };
};

// Calculate draw equity
const calculateDrawEquity = (holeCards: Card[], communityCards: Card[]): DrawEquity => {
  if (communityCards.length === 0 || communityCards.length >= 5) {
    return { flushOuts: 0, straightOuts: 0, totalOuts: 0, equity: 0, impliedOdds: 0 };
  }

  const allCards = [...holeCards, ...communityCards];
  const suits = allCards.map(c => c.suit);
  const ranks = allCards.map(c => RANK_VALUES[c.rank]);

  // Flush outs
  const suitCounts: Record<string, number> = {};
  suits.forEach(s => suitCounts[s] = (suitCounts[s] || 0) + 1);
  const maxSuit = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
  let flushOuts = 0;
  if (maxSuit && maxSuit[1] === 4) flushOuts = 9; // 4 to a flush = 9 outs
  else if (maxSuit && maxSuit[1] === 3 && communityCards.length <= 3) flushOuts = 2; // Backdoor

  // Straight outs (simplified)
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  let straightOuts = 0;
  
  // Check for open-ended straight draw
  for (let i = 0; i <= uniqueRanks.length - 4; i++) {
    const consecutive = uniqueRanks.slice(i, i + 4);
    if (consecutive[3] - consecutive[0] === 3) {
      straightOuts = 8; // Open-ended = 8 outs
      break;
    }
  }
  
  // Check for gutshot
  if (straightOuts === 0) {
    for (let target = 5; target <= 14; target++) {
      const needed = [target - 4, target - 3, target - 2, target - 1, target];
      const have = needed.filter(r => uniqueRanks.includes(r) || (r === 1 && uniqueRanks.includes(14)));
      if (have.length === 4) {
        straightOuts = 4; // Gutshot = 4 outs
        break;
      }
    }
  }

  // Remove duplicate outs (straight flush potential)
  const totalOuts = flushOuts + straightOuts - (flushOuts > 0 && straightOuts > 0 ? 2 : 0);
  
  // Equity approximation (rule of 2 and 4)
  const multiplier = communityCards.length === 3 ? 4 : 2;
  const equity = Math.min(totalOuts * multiplier, 60);
  
  // Implied odds boost for hidden draws
  const impliedOdds = equity * 1.2;

  return { flushOuts, straightOuts, totalOuts, equity, impliedOdds };
};

// GTO-inspired range percentages by position (% of hands to play)
const GTO_RANGES: Record<Position, { open: number; call: number; threeBet: number }> = {
  'UTG': { open: 12, call: 8, threeBet: 4 },
  'UTG+1': { open: 14, call: 9, threeBet: 4.5 },
  'MP': { open: 18, call: 11, threeBet: 5 },
  'HJ': { open: 22, call: 13, threeBet: 6 },
  'CO': { open: 28, call: 16, threeBet: 8 },
  'BTN': { open: 42, call: 22, threeBet: 10 },
  'SB': { open: 35, call: 18, threeBet: 9 },
  'BB': { open: 25, call: 35, threeBet: 11 },
};

// Aggression factors by street (how much to multiply base aggression)
const STREET_AGGRESSION: Record<Street, number> = {
  'preflop': 1.0,
  'flop': 1.2,
  'turn': 1.4,
  'river': 1.6,
  'showdown': 1.0,
};

// --- Hand Evaluation ---

const RANK_VALUES: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const getHandStrength = (cards: Card[]): number => {
  if (cards.length < 2) return 0;
  const [c1, c2] = cards;
  const high = Math.max(RANK_VALUES[c1.rank], RANK_VALUES[c2.rank]);
  const low = Math.min(RANK_VALUES[c1.rank], RANK_VALUES[c2.rank]);
  const suited = c1.suit === c2.suit;
  const paired = c1.rank === c2.rank;

  let strength = 0;

  // Pocket pairs
  if (paired) {
    strength = 50 + high * 3;
    if (high >= 10) strength += 20; // Premium pairs
    if (high >= 13) strength += 15; // AA, KK
  } else {
    // High cards
    strength = high + low * 0.5;
    if (suited) strength += 8;

    // Connected cards
    const gap = high - low;
    if (gap === 1) strength += 6;
    else if (gap === 2) strength += 3;
    else if (gap === 3) strength += 1;

    // Broadway cards
    if (high >= 10 && low >= 10) strength += 15;

    // Ace-high hands
    if (high === 14) {
      strength += 10;
      if (low >= 10) strength += 10; // AK, AQ, AJ, AT
    }
  }

  return Math.min(100, strength);
};

const evaluateBoardStrength = (holeCards: Card[], communityCards: Card[]): number => {
  if (communityCards.length === 0) return getHandStrength(holeCards);

  const allCards = [...holeCards, ...communityCards];
  let strength = getHandStrength(holeCards);

  // Check for pairs, trips, etc. with board
  const rankCounts: Record<string, number> = {};
  allCards.forEach(c => {
    rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  });

  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  if (counts[0] === 4) strength += 80; // Quads
  else if (counts[0] === 3 && counts[1] === 2) strength += 70; // Full house
  else if (counts[0] === 3) strength += 50; // Trips
  else if (counts[0] === 2 && counts[1] === 2) strength += 30; // Two pair
  else if (counts[0] === 2) strength += 15; // Pair

  // Check for flush
  const suitCounts: Record<string, number> = {};
  allCards.forEach(c => {
    suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  });
  if (Object.values(suitCounts).some(c => c >= 5)) strength += 60;

  // Check for straight potential
  const uniqueRanks = [...new Set(allCards.map(c => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i + 4] - uniqueRanks[i] === 4) strength += 55;
  }

  return Math.min(100, strength);
};

// --- Position Strategy ---

const getPositionStrategy = (position: Position, street: Street): string => {
  const strategies: Record<Position, Record<Street, string>> = {
    'UTG': {
      'preflop': 'UTG (Under The Gun): Play TIGHT. Only open with premium hands (AA-TT, AK, AQ). You act first with 7 players behind - discipline is key.',
      'flop': 'UTG: Continuation bet with strong hands. Check-fold weak hands. Position disadvantage means you need stronger holdings.',
      'turn': 'UTG: Narrow your range. Only continue with made hands or strong draws. Pot control with medium strength.',
      'river': 'UTG: Value bet strong hands, check-call medium hands. Avoid bluffing from early position.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'UTG+1': {
      'preflop': 'UTG+1: Still early position. Play tight but slightly wider than UTG. Add 99, AJs to your range.',
      'flop': 'UTG+1: Similar to UTG. C-bet strong hands, check weak ones. Still at positional disadvantage.',
      'turn': 'UTG+1: Narrow your range. Only continue with made hands or strong draws.',
      'river': 'UTG+1: Value bet strong hands. Avoid bluffing without strong reads.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'MP': {
      'preflop': 'MP (Middle Position): Slightly wider than UTG. Add 99-77, AJ, KQ to your range. Still be cautious.',
      'flop': 'MP: Semi-bluff with draws, value bet made hands. Watch for late position aggression.',
      'turn': 'MP: Evaluate board texture. Bet for value or check to control pot size.',
      'river': 'MP: Make disciplined folds to aggression. Value bet thinly against passive players.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'CO': {
      'preflop': 'CO (Cutoff): Wide stealing range when folded to you. Open 22+, suited connectors, most broadways.',
      'flop': 'CO: Attack weakness. C-bet frequently when checked to. Float with position.',
      'turn': 'CO: Apply pressure with position advantage. Double-barrel with equity.',
      'river': 'CO: Bluff catch effectively. Your position lets you make better decisions.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'HJ': {
      'preflop': 'HJ (Hijack): Similar to CO but slightly tighter. Good stealing position.',
      'flop': 'HJ: Play aggressively with position. C-bet bluff on dry boards.',
      'turn': 'HJ: Barrel with equity or give up. Avoid spewy plays.',
      'river': 'HJ: Thin value bets are profitable here. Bluff selectively.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'BTN': {
      'preflop': 'BTN (Button): BEST position! Open very wide (40%+ of hands). Steal blinds aggressively.',
      'flop': 'BTN: C-bet liberally. You always act last - huge advantage. Float and raise light.',
      'turn': 'BTN: Continue aggression. Your position makes opponents uncomfortable.',
      'river': 'BTN: Maximum flexibility. Bluff more, value bet thinner. Own this street.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'SB': {
      'preflop': 'SB (Small Blind): Worst position postflop. 3-bet or fold vs opens. Complete vs limps selectively.',
      'flop': 'SB: Play defensively. Check-raise strong hands. Donk bet rarely.',
      'turn': 'SB: Be prepared to check-call or check-fold. Leading is usually weak.',
      'river': 'SB: Value bet strong hands. Check-call medium strength. Tough spot overall.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    },
    'BB': {
      'preflop': 'BB (Big Blind): Defend your blind! You have pot odds. Call with wide range vs steals.',
      'flop': 'BB: Check-raise for value and as bluffs. Donk bet sometimes with strong hands.',
      'turn': 'BB: Continue aggression if you took the lead. Otherwise play fit-or-fold.',
      'river': 'BB: Showdown value is key. Bluff catch vs aggressive players.',
      'showdown': 'Hand complete. Review your decisions against optimal play.'
    }
  };

  return strategies[position]?.[street] || 'Play solid poker based on your hand strength and position.';
};

const getOptimalAction = (
  handStrength: number,
  position: Position,
  street: Street,
  potOdds: number,
  facingBet: boolean,
  _betAmount: number
): string => {
  // GTO-inspired recommendations with detailed position explanations
  if (street === 'preflop') {
    if (handStrength >= 85) return 'RAISE 3-4x BB - Premium hand, build the pot!';
    if (handStrength >= 70) return facingBet ? 'CALL or 3-BET - Strong hand, play aggressively' : 'RAISE 2.5-3x BB';
    if (handStrength >= 50) {
      if (position === 'BTN' || position === 'CO') return 'RAISE to steal or CALL if raised - Late position gives you info advantage';
      if (position === 'UTG') return facingBet ? 'FOLD - UTG needs top 15% hands, too many players left to act' : 'FOLD - UTG requires premium hands (top 10-15%) as 6 players act after you';
      if (position === 'MP') return facingBet ? 'FOLD - MP needs strong hands, still 4-5 players behind' : 'FOLD - MP position too early for marginal hands';
      if (position === 'HJ') return facingBet ? 'CALL if pot odds good, else FOLD' : 'Consider RAISE with suited connectors, otherwise FOLD';
      return facingBet ? 'CALL if pot odds good, else FOLD' : 'FOLD from early position';
    }
    if (handStrength >= 30) {
      if (position === 'BTN' || position === 'CO') return facingBet ? 'FOLD to aggression - Hand can\'t stand a raise' : 'RAISE to steal blinds - Late position advantage';
      if (position === 'SB') return facingBet ? 'FOLD - SB is worst postflop position' : 'Complete or RAISE to isolate BB';
      if (position === 'BB') return facingBet ? 'FOLD unless getting 4:1+ odds' : 'CHECK your option - Free card!';
      if (position === 'UTG') return `FOLD - ${Math.round(handStrength)}% hand strength is too weak for UTG. Need 65%+ to open from first position (pairs 77+, AQ+, KQs)`;
      if (position === 'MP') return `FOLD - ${Math.round(handStrength)}% too weak for MP. With 4-5 players behind, need 55%+ hands (pairs 55+, AJ+, KQ, suited connectors)`;
      if (position === 'HJ') return `FOLD - ${Math.round(handStrength)}% marginal for HJ. Need 45%+ (pairs 33+, AT+, suited broadway)`;
      return 'FOLD - Hand too weak for this position';
    }
    // Very weak hands
    if (position === 'UTG') return `FOLD - ${Math.round(handStrength)}% is unplayable from UTG. First to act = tightest range. You need AA-77, AK-AQ, KQs type hands`;
    if (position === 'MP') return `FOLD - ${Math.round(handStrength)}% is unplayable from MP. Still early position with many players behind`;
    if (position === 'HJ') return `FOLD - ${Math.round(handStrength)}% too weak even for Hijack. Save chips for better spots`;
    if (position === 'CO') return `FOLD - ${Math.round(handStrength)}% too weak even for Cutoff. Need at least 30% hand to steal`;
    if (position === 'BTN') return `FOLD - ${Math.round(handStrength)}% unplayable even on Button. Best position but still need some equity`;
    if (position === 'SB') return `FOLD - ${Math.round(handStrength)}% trash hand. SB is worst position postflop, don't invest more`;
    if (position === 'BB') return facingBet ? `FOLD - ${Math.round(handStrength)}% can't defend even with position in pot` : 'CHECK - See free flop with any two cards';
    return 'FOLD - Hand too weak for this position';
  }

  // Postflop
  if (handStrength >= 80) return 'BET/RAISE for value - You likely have the best hand';
  if (handStrength >= 60) return facingBet ? 'CALL - Good hand but be cautious of raises' : 'BET 50-75% pot for value';
  if (handStrength >= 40) return facingBet ? `CALL if pot odds > ${Math.round(potOdds)}% - You have ${Math.round(handStrength)}% equity` : 'CHECK - Pot control with medium strength';
  if (handStrength >= 20) return facingBet ? `FOLD - ${Math.round(handStrength)}% equity can't call ${Math.round(potOdds)}% pot odds profitably` : 'CHECK - No value betting weak hands';
  return `CHECK/FOLD - Only ${Math.round(handStrength)}% equity, minimize losses and wait for better spot`;
};

// --- Utility Functions ---

const createDeck = (): Card[] => {
  const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ rank, suit });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const dealCards = (deck: Card[], count: number): Card[] => {
  return deck.splice(0, count);
};

// --- Tutorial System ---

interface TutorialLesson {
  id: string;
  title: string;
  category: string;
  content: TutorialSection[];
}

interface TutorialSection {
  type: 'text' | 'cards' | 'table' | 'quiz' | 'tip' | 'warning' | 'example';
  title?: string;
  content: string;
  cards?: Card[];
  tableData?: { headers: string[]; rows: string[][] };
  quizOptions?: { text: string; correct: boolean; explanation: string }[];
}

const TUTORIAL_LESSONS: TutorialLesson[] = [
  {
    id: 'intro',
    title: 'Welcome to Texas Hold\'em',
    category: 'Basics',
    content: [
      { type: 'text', content: 'Texas Hold\'em is the most popular form of poker in the world. Each player receives 2 private cards (hole cards), and 5 community cards are dealt face-up on the board. Your goal is to make the best 5-card hand using any combination of your hole cards and the community cards.' },
      { type: 'tip', title: 'Key Concept', content: 'You can use both, one, or none of your hole cards combined with the community cards to make your best hand.' },
      { type: 'text', title: 'The Four Betting Rounds', content: '1. **Preflop** - After receiving your 2 hole cards\n2. **Flop** - After the first 3 community cards are dealt\n3. **Turn** - After the 4th community card\n4. **River** - After the 5th and final community card' },
      { type: 'text', title: 'Winning the Pot', content: 'You can win by either:\n• Having the best hand at showdown\n• Making all other players fold before showdown' }
    ]
  },
  {
    id: 'hand-rankings',
    title: 'Hand Rankings',
    category: 'Basics',
    content: [
      { type: 'text', content: 'Poker hands are ranked from highest to lowest. Memorizing these is essential!' },
      { type: 'table', title: 'Hand Rankings (Highest to Lowest)', content: '', tableData: { headers: ['Rank', 'Hand', 'Example', 'Description'], rows: [['1', 'Royal Flush', 'A♠ K♠ Q♠ J♠ T♠', 'A-K-Q-J-T all same suit'], ['2', 'Straight Flush', '9♥ 8♥ 7♥ 6♥ 5♥', '5 consecutive cards, same suit'], ['3', 'Four of a Kind', 'K♠ K♥ K♦ K♣ 7♠', '4 cards of same rank'], ['4', 'Full House', 'Q♠ Q♥ Q♦ 8♣ 8♠', '3 of a kind + a pair'], ['5', 'Flush', 'A♦ J♦ 8♦ 6♦ 2♦', '5 cards same suit, any order'], ['6', 'Straight', 'T♠ 9♥ 8♦ 7♣ 6♠', '5 consecutive cards, any suit'], ['7', 'Three of a Kind', '7♠ 7♥ 7♦ K♣ 2♠', '3 cards of same rank'], ['8', 'Two Pair', 'J♠ J♥ 5♦ 5♣ A♠', '2 different pairs'], ['9', 'One Pair', '9♠ 9♥ A♦ K♣ 4♠', '2 cards of same rank'], ['10', 'High Card', 'A♠ J♥ 8♦ 5♣ 2♠', 'No made hand, highest card plays']] } },
      { type: 'tip', title: 'Memory Trick', content: 'Royal Flush is the rarest hand - you\'ll see it roughly once every 650,000 hands. A pair is the most common made hand, appearing about 42% of the time.' },
      { type: 'warning', title: 'Common Mistake', content: 'A flush beats a straight! Many beginners get this wrong. Remember: it\'s harder to get 5 cards of the same suit than 5 consecutive cards.' }
    ]
  },
  {
    id: 'positions',
    title: 'Table Positions',
    category: 'Basics',
    content: [
      { type: 'text', content: 'Position is one of the most important concepts in poker. Where you sit relative to the dealer button determines when you act - and acting last is a HUGE advantage.' },
      { type: 'table', title: 'The 8 Positions', content: '', tableData: { headers: ['Position', 'Full Name', 'Type', 'Advantage'], rows: [['BTN', 'Button (Dealer)', 'Late', '★★★★★ Best position - always acts last postflop'], ['SB', 'Small Blind', 'Blind', '★☆☆☆☆ Worst - posts half blind, acts first postflop'], ['BB', 'Big Blind', 'Blind', '★★☆☆☆ Posts full blind, but acts last preflop'], ['UTG', 'Under the Gun', 'Early', '★★☆☆☆ First to act preflop - very tough spot'], ['UTG+1', 'UTG+1', 'Early', '★★☆☆☆ Second to act - still early position'], ['MP', 'Middle Position', 'Middle', '★★★☆☆ Middle ground - moderate advantage'], ['HJ', 'Hijack', 'Late', '★★★★☆ Two before button - good stealing position'], ['CO', 'Cutoff', 'Late', '★★★★★ One before button - excellent position']] } },
      { type: 'text', title: 'Why Position Matters', content: '**Information Advantage**: When you act last, you see what everyone else does before making your decision.\n\n**Pot Control**: You can check behind to keep pots small with marginal hands.\n\n**Bluffing**: Easier to bluff when you see weakness (checks) from opponents.\n\n**Value**: You can bet for value more accurately knowing the action.' },
      { type: 'tip', title: 'Golden Rule', content: 'Play TIGHT in early position (only premium hands) and LOOSE in late position (wider range of hands). The button can profitably play ~40% of hands, while UTG should only play ~12%.' }
    ]
  },
  {
    id: 'actions',
    title: 'Betting Actions',
    category: 'Basics',
    content: [
      { type: 'table', title: 'Your Options', content: '', tableData: { headers: ['Action', 'When Available', 'What It Means'], rows: [['Fold', 'Always', 'Surrender your hand and any chips you\'ve put in'], ['Check', 'No bet to call', 'Pass the action without betting (stay in hand for free)'], ['Call', 'Facing a bet', 'Match the current bet to stay in the hand'], ['Raise', 'Usually always', 'Increase the bet - others must call or re-raise'], ['All-In', 'Always', 'Bet all your remaining chips']] } },
      { type: 'text', title: 'Minimum Raise Rules', content: 'The minimum raise must be at least the size of the previous raise. Example:\n• If the big blind is $50 and someone raises to $150 (a $100 raise)\n• The minimum re-raise is $250 ($150 + $100)' },
      { type: 'warning', title: 'String Betting', content: 'In live poker, you must announce "raise" or put all chips in at once. Saying "I call... and raise" is called a string bet and is not allowed!' }
    ]
  },
  {
    id: 'terms-betting',
    title: 'Betting Terminology',
    category: 'Terminology',
    content: [
      { type: 'table', title: 'Essential Betting Terms', content: '', tableData: { headers: ['Term', 'Definition', 'Example'], rows: [['C-Bet', 'Continuation Bet - betting the flop after raising preflop', 'You raise with AK, flop is 7-4-2, you bet anyway'], ['3-Bet', 'Re-raising a raise (the 3rd bet)', 'Someone raises, you re-raise - that\'s a 3-bet'], ['4-Bet', 'Re-raising a 3-bet', 'They raise, you 3-bet, they 4-bet'], ['Donk Bet', 'Betting into the preflop raiser out of position', 'You called preflop, then lead the flop betting'], ['Value Bet', 'Betting with a strong hand to get called by worse', 'You have top pair and bet for value'], ['Bluff', 'Betting with a weak hand to make better hands fold', 'You have nothing but bet to represent strength'], ['Semi-Bluff', 'Bluffing with a draw that could improve', 'Betting a flush draw - you might win now or hit later'], ['Check-Raise', 'Checking then raising when someone bets', 'Trapping with a strong hand'], ['Overbet', 'Betting more than the pot size', 'Pot is $100, you bet $150+'], ['Block Bet', 'Small bet to prevent a larger bet', 'Betting 25% pot to control the price']] } },
      { type: 'example', title: 'C-Bet in Action', content: 'You raise preflop with A♠K♠. The flop comes 7♦4♣2♥ - you completely missed! But you bet anyway (a c-bet) because:\n1. You showed strength preflop\n2. This flop likely missed your opponent too\n3. Many hands will fold to your continued aggression' }
    ]
  },
  {
    id: 'terms-math',
    title: 'Poker Math Terms',
    category: 'Terminology',
    content: [
      { type: 'table', title: 'Math Terminology', content: '', tableData: { headers: ['Term', 'Definition', 'Why It Matters'], rows: [['Pot Odds', 'Ratio of call amount to pot size', 'Determines if a call is profitable'], ['Equity', 'Your % chance to win the hand', 'AA vs KK = ~80% equity for AA'], ['Outs', 'Cards that improve your hand', 'Flush draw = 9 outs'], ['Implied Odds', 'Pot odds + future betting', 'If you hit, you\'ll win more'], ['Reverse Implied', 'Risk of losing more when you hit', 'Making 2nd best hand'], ['EV (Expected Value)', 'Long-term average profit/loss', '+EV = profitable, -EV = losing'], ['SPR', 'Stack-to-Pot Ratio', 'Low SPR = commit with top pair'], ['Fold Equity', 'Chance opponent folds to your bet', 'Makes bluffs profitable']] } },
      { type: 'text', title: 'The Rule of 2 and 4', content: 'Quick way to calculate your equity with a draw:\n\n**Flop to River**: Multiply outs × 4\n**Turn to River**: Multiply outs × 2\n\nExample: You have a flush draw (9 outs)\n• On the flop: 9 × 4 = ~36% to hit\n• On the turn: 9 × 2 = ~18% to hit' },
      { type: 'example', title: 'Pot Odds Calculation', content: 'The pot is $100. Your opponent bets $50. You need to call $50 to win $150.\n\n**Pot Odds** = $50 / ($100 + $50 + $50) = $50 / $200 = 25%\n\nYou need at least 25% equity to call profitably. With a flush draw (~36%), this is an easy call!' }
    ]
  },
  {
    id: 'terms-players',
    title: 'Player Types & Stats',
    category: 'Terminology',
    content: [
      { type: 'table', title: 'Player Statistics', content: '', tableData: { headers: ['Stat', 'Full Name', 'What It Shows', 'Good Range'], rows: [['VPIP', 'Voluntarily Put $ In Pot', 'How loose/tight they play', '18-25% is solid'], ['PFR', 'Preflop Raise %', 'How aggressive preflop', '15-20% is good'], ['AF', 'Aggression Factor', 'Bets+Raises / Calls', '2-3 is balanced'], ['3-Bet %', 'Re-raise frequency', 'How often they 3-bet', '6-10% is normal'], ['Fold to C-Bet', 'C-bet fold frequency', 'How often they give up', '40-50% is normal']] } },
      { type: 'table', title: 'Player Types', content: '', tableData: { headers: ['Type', 'VPIP', 'AF', 'Description'], rows: [['TAG', 'Low (18-24%)', 'High (2-3)', 'Tight-Aggressive: The winning style'], ['LAG', 'High (28-35%)', 'High (3+)', 'Loose-Aggressive: Skilled & dangerous'], ['Nit', 'Very Low (<15%)', 'Low', 'Only plays premium hands'], ['Fish', 'Very High (40%+)', 'Low', 'Plays too many hands passively'], ['Maniac', 'Very High', 'Very High', 'Bets and raises everything']] } },
      { type: 'tip', title: 'Exploiting Player Types', content: '• **vs Nits**: Steal their blinds relentlessly, fold when they bet big\n• **vs Fish**: Value bet thinner, don\'t bluff (they call everything)\n• **vs LAGs**: Trap with strong hands, call down lighter\n• **vs Maniacs**: Let them hang themselves, wait for hands' }
    ]
  },
  {
    id: 'board-texture',
    title: 'Reading Board Texture',
    category: 'Strategy',
    content: [
      { type: 'text', content: 'Board texture refers to how the community cards interact with possible hands. Understanding this is crucial for making good decisions.' },
      { type: 'table', title: 'Board Types', content: '', tableData: { headers: ['Type', 'Example', 'Characteristics', 'Strategy'], rows: [['Dry', 'K♠ 7♦ 2♣', 'No draws, disconnected', 'C-bet often, bluff more'], ['Wet', 'J♥ T♥ 8♠', 'Many draws possible', 'Bet for value/protection'], ['Paired', 'Q♠ Q♦ 5♣', 'Pair on board', 'Full houses possible, polarize'], ['Monotone', 'A♦ 8♦ 3♦', 'Three of same suit', 'Flush already possible!'], ['Rainbow', 'K♠ 9♥ 4♦', 'All different suits', 'No flush draws']] } },
      { type: 'example', title: 'Wet vs Dry Board', content: '**Dry Board (K♠ 7♦ 2♣)**:\nFew draws exist. If you have K-Q, you likely have the best hand. C-bet freely as bluffs work well.\n\n**Wet Board (J♥ T♥ 8♠)**:\nStraight draws (Q9, 97), flush draws (any two hearts), combo draws everywhere. Bet larger for protection. Don\'t bluff much - too many draws will call.' }
    ]
  },
  {
    id: 'pot-odds',
    title: 'Pot Odds Mastery',
    category: 'Strategy',
    content: [
      { type: 'text', content: 'Pot odds compare the size of the bet you must call to the total pot. If your equity exceeds your pot odds, calling is profitable long-term.' },
      { type: 'table', title: 'Common Pot Odds', content: '', tableData: { headers: ['Bet Size', 'Pot Odds', 'Equity Needed'], rows: [['25% pot', '16.7%', 'Any draw'], ['33% pot', '20%', '4+ outs'], ['50% pot', '25%', '5+ outs'], ['66% pot', '28.5%', '6+ outs'], ['75% pot', '30%', '6-7 outs'], ['100% pot', '33%', '7+ outs'], ['150% pot', '37.5%', '8+ outs']] } },
      { type: 'table', title: 'Common Drawing Hands', content: '', tableData: { headers: ['Draw', 'Outs', 'Flop Equity', 'Turn Equity'], rows: [['Flush Draw', '9', '35%', '19%'], ['Open-Ended Straight', '8', '31%', '17%'], ['Gutshot Straight', '4', '17%', '9%'], ['Flush + Gutshot', '12', '45%', '26%'], ['Flush + Open-Ended', '15', '54%', '33%'], ['Two Overcards', '6', '24%', '13%'], ['Set to Full House', '7', '28%', '15%']] } },
      { type: 'tip', title: 'Implied Odds', content: 'Pot odds don\'t tell the whole story. If you\'re drawing to a hidden hand (like a flush with small suited cards), you\'ll often win extra bets when you hit. Add ~10-20% to your "effective odds" for hidden draws.' }
    ]
  },
  {
    id: 'preflop-strategy',
    title: 'Preflop Strategy',
    category: 'Strategy',
    content: [
      { type: 'text', content: 'What hands to play preflop depends heavily on your position. Here\'s a simplified guide for beginners.' },
      { type: 'table', title: 'Starting Hand Guide by Position', content: '', tableData: { headers: ['Position', 'Premium Open', 'Standard Open', 'Avoid'], rows: [['UTG/UTG+1', 'AA-TT, AK, AQs', 'AQo, KQs, AJs', 'Small pairs, suited connectors'], ['MP', 'AA-99, AK-AJ, KQs', '88-77, ATs, KJs', 'Weak aces, small suited'], ['HJ/CO', 'AA-77, AK-AT, KQ-KT', '66-22, suited connectors', 'Only fold trash'], ['BTN', 'Almost everything!', 'Any ace, any pair', 'Only worst hands'], ['SB', '3-bet or fold mostly', 'Wide 3-bet range', 'Don\'t just call'], ['BB', 'Defend wide vs steals', 'Any playable hand', 'Fold to huge raises']] } },
      { type: 'warning', title: 'Common Preflop Leaks', content: '• **Calling too much from the blinds** - You\'re out of position, be selective\n• **Playing weak aces** - A2-A8 are trap hands, often dominated\n• **Cold calling 3-bets** - Usually should fold or 4-bet, rarely call\n• **Not adjusting to position** - Playing the same hands everywhere' }
    ]
  },
  {
    id: 'postflop-strategy',
    title: 'Postflop Strategy',
    category: 'Strategy',
    content: [
      { type: 'text', title: 'The Three Questions', content: 'Before every postflop decision, ask yourself:\n1. **What is my hand strength?** (Monster, strong, medium, weak, draw)\n2. **What is the board texture?** (Wet, dry, paired, scary)\n3. **What does my opponent likely have?** (Their range)' },
      { type: 'table', title: 'Hand Strength Categories', content: '', tableData: { headers: ['Category', 'Examples', 'Goal'], rows: [['Monster', 'Sets, straights, flushes', 'Build pot, get all-in'], ['Strong', 'Top pair good kicker, overpairs', 'Value bet, but be cautious'], ['Medium', 'Middle pair, weak top pair', 'Pot control, showdown value'], ['Weak', 'Bottom pair, no pair', 'Check/fold or bluff'], ['Draw', 'Flush draw, straight draw', 'Semi-bluff or call with odds']] } },
      { type: 'tip', title: 'The Fundamental Theorem', content: 'Every time you play a hand differently than you would if you could see your opponent\'s cards, you lose money. Every time you make them play differently than they would seeing yours, you gain.' }
    ]
  },
  {
    id: 'bluffing',
    title: 'The Art of Bluffing',
    category: 'Strategy',
    content: [
      { type: 'text', content: 'Bluffing is betting or raising with a weak hand to make better hands fold. It\'s essential to a balanced strategy, but many players bluff incorrectly.' },
      { type: 'table', title: 'When to Bluff', content: '', tableData: { headers: ['Good Time to Bluff', 'Bad Time to Bluff'], rows: [['Dry boards (K-7-2)', 'Wet boards (J-T-8)'], ['Against tight players', 'Against calling stations'], ['When you have blockers', 'When you block nothing'], ['In position', 'Out of position'], ['When story makes sense', 'Random bluffs'], ['Against 1-2 opponents', 'Against many players']] } },
      { type: 'text', title: 'Blockers Explained', content: 'Blockers are cards in your hand that reduce the likelihood your opponent has certain hands.\n\n**Example**: You have A♥ on a board of K♥ 9♥ 4♥ 2♠ 7♣\n\nYou don\'t have a flush, but you BLOCK the nut flush (your opponent can\'t have A♥). This makes it a great bluffing spot!' },
      { type: 'warning', title: 'Bluffing Mistakes', content: '• **Bluffing calling stations** - They don\'t fold, just value bet them\n• **Too small bluffs** - Give your opponent good odds to call\n• **Bluffing multiple players** - Someone usually has something\n• **No story** - Your bluff should represent a believable hand' }
    ]
  },
  {
    id: 'bankroll',
    title: 'Bankroll Management',
    category: 'Advanced',
    content: [
      { type: 'text', content: 'Even winning players experience significant downswings. Proper bankroll management ensures you don\'t go broke during bad runs.' },
      { type: 'table', title: 'Recommended Bankroll', content: '', tableData: { headers: ['Game Type', 'Buy-ins', 'Example ($100 buy-in)'], rows: [['Cash Games (recreational)', '20 buy-ins', '$2,000 bankroll'], ['Cash Games (serious)', '30-50 buy-ins', '$3,000-5,000'], ['Tournaments (recreational)', '50 buy-ins', '$5,000'], ['Tournaments (serious)', '100+ buy-ins', '$10,000+']] } },
      { type: 'tip', title: 'Move Down, Not Broke', content: 'If you lose 30% of your bankroll, move down in stakes. Protect your roll! You can always move back up when you recover.' }
    ]
  }
];

// Tutorial Component
const Tutorial: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0);
  const [showCategories, setShowCategories] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = [...new Set(TUTORIAL_LESSONS.map(l => l.category))];
  const filteredLessons = selectedCategory 
    ? TUTORIAL_LESSONS.filter(l => l.category === selectedCategory)
    : TUTORIAL_LESSONS;
  const currentLesson = filteredLessons[currentLessonIndex];

  const renderSection = (section: TutorialSection, idx: number) => {
    switch (section.type) {
      case 'text':
        return (
          <div key={idx} className="mb-4">
            {section.title && <h3 className="text-lg font-bold text-yellow-400 mb-2">{section.title}</h3>}
            <div className="text-gray-300 whitespace-pre-line leading-relaxed">
              {section.content.split('**').map((part, i) => 
                i % 2 === 1 ? <strong key={i} className="text-white">{part}</strong> : part
              )}
            </div>
          </div>
        );
      case 'table':
        return (
          <div key={idx} className="mb-4">
            {section.title && <h3 className="text-lg font-bold text-yellow-400 mb-2">{section.title}</h3>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-700">
                    {section.tableData?.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left text-yellow-300 font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.tableData?.rows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-gray-800' : 'bg-gray-750'}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 text-gray-300">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      case 'tip':
        return (
          <div key={idx} className="mb-4 p-4 bg-green-900/30 border border-green-600 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">💡</span>
              <span className="font-bold text-green-400">{section.title || 'Tip'}</span>
            </div>
            <p className="text-gray-300">{section.content}</p>
          </div>
        );
      case 'warning':
        return (
          <div key={idx} className="mb-4 p-4 bg-red-900/30 border border-red-600 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">⚠️</span>
              <span className="font-bold text-red-400">{section.title || 'Warning'}</span>
            </div>
            <p className="text-gray-300">{section.content}</p>
          </div>
        );
      case 'example':
        return (
          <div key={idx} className="mb-4 p-4 bg-blue-900/30 border border-blue-600 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">📝</span>
              <span className="font-bold text-blue-400">{section.title || 'Example'}</span>
            </div>
            <p className="text-gray-300 whitespace-pre-line">{section.content}</p>
          </div>
        );
      default:
        return null;
    }
  };

  if (showCategories) {
    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <PokerIcon name="tutorial" size={36} />
              Poker Tutorial
            </h1>
            <button
              onClick={onExit}
              className="px-4 py-2 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937]"
            >
              ← Back to Menu
            </button>
          </div>
          
          <p className="text-gray-400 mb-8">Master Texas Hold'em from the basics to advanced strategy. Select a category to begin.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {categories.map(cat => {
              const lessonCount = TUTORIAL_LESSONS.filter(l => l.category === cat).length;
              const icons: Record<string, string> = {
                'Basics': '🎯',
                'Terminology': '📖',
                'Strategy': '🧠',
                'Advanced': '🚀'
              };
              return (
                <button
                  key={cat}
                  onClick={() => { setSelectedCategory(cat); setShowCategories(false); setCurrentLessonIndex(0); }}
                  className="p-6 bg-gray-800 hover:bg-gray-700 rounded-xl border border-gray-600 text-left transition-all hover:border-yellow-500"
                >
                  <div className="text-3xl mb-2">{icons[cat] || '📄'}</div>
                  <h2 className="text-xl font-bold text-white mb-1">{cat}</h2>
                  <p className="text-gray-400 text-sm">{lessonCount} lessons</p>
                </button>
              );
            })}
          </div>
          
          <button
            onClick={() => { setSelectedCategory(null); setShowCategories(false); setCurrentLessonIndex(0); }}
            className="w-full p-4 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl transition-colors"
          >
            📖 Start from Beginning (All Lessons)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setShowCategories(true)}
            className="px-4 py-2 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937]"
          >
            ← Categories
          </button>
          <div className="text-gray-400 text-sm">
            Lesson {currentLessonIndex + 1} of {filteredLessons.length}
          </div>
          <button
            onClick={onExit}
            className="px-4 py-2 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937]"
          >
            Exit Tutorial
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-gray-700 rounded-full mb-6">
          <div 
            className="h-full bg-yellow-500 rounded-full transition-all duration-300"
            style={{ width: `${((currentLessonIndex + 1) / filteredLessons.length) * 100}%` }}
          />
        </div>

        {/* Lesson Content */}
        <div className="bg-gray-800 rounded-xl p-6 mb-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <span className="px-3 py-1 bg-yellow-600 text-black text-xs font-bold rounded-full">
              {currentLesson.category}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-6">{currentLesson.title}</h2>
          
          <div className="space-y-4">
            {currentLesson.content.map((section, idx) => renderSection(section, idx))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between gap-4">
          <button
            onClick={() => setCurrentLessonIndex(Math.max(0, currentLessonIndex - 1))}
            disabled={currentLessonIndex === 0}
            className="flex-1 px-6 py-3 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 disabled:from-gray-800 disabled:to-gray-900 disabled:text-gray-600 text-white font-bold rounded-xl transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_3px_0_0_#1f2937,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937] disabled:shadow-none disabled:transform-none"
          >
            ← Previous
          </button>
          <button
            onClick={() => setCurrentLessonIndex(Math.min(filteredLessons.length - 1, currentLessonIndex + 1))}
            disabled={currentLessonIndex === filteredLessons.length - 1}
            className="flex-1 px-6 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-800 disabled:text-gray-600 text-black font-bold rounded-xl transition-colors"
          >
            Next →
          </button>
        </div>

        {/* Lesson List */}
        <div className="mt-8">
          <h3 className="text-lg font-bold text-white mb-4">All Lessons in {selectedCategory || 'Tutorial'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {filteredLessons.map((lesson, idx) => (
              <button
                key={lesson.id}
                onClick={() => setCurrentLessonIndex(idx)}
                className={`p-3 text-left rounded-lg transition-colors ${
                  idx === currentLessonIndex 
                    ? 'bg-yellow-600 text-black' 
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="text-sm">{idx + 1}. {lesson.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Interactive Tutorial ---

interface TutorialStage {
  id: string;
  title: string;
  description: string;
  setupHand: { playerCards: [Card, Card]; communityCards: Card[]; position: Position; pot: number; currentBet: number; street: Street };
  steps: TutorialStep[];
}

interface TutorialStep {
  message: string;
  highlightArea?: 'cards' | 'position' | 'pot' | 'actions' | 'community' | 'odds';
  waitForAction?: ActionType;
  correctAction?: ActionType;
  explanation?: string;
  showPotOdds?: boolean;
  showHandStrength?: boolean;
}

const INTERACTIVE_STAGES: TutorialStage[] = [
  {
    id: 'welcome',
    title: 'Welcome to Poker!',
    description: 'Let\'s learn the basics by playing actual hands.',
    setupHand: {
      playerCards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }],
      communityCards: [],
      position: 'BTN',
      pot: 75,
      currentBet: 50,
      street: 'preflop'
    },
    steps: [
      { message: 'Welcome! This interactive tutorial will teach you Texas Hold\'em by playing real hands. Let\'s start!', highlightArea: 'cards' },
      { message: 'You\'ve been dealt two cards - these are your HOLE CARDS. Only you can see them!', highlightArea: 'cards', showHandStrength: true },
      { message: 'You have Pocket Aces (AA) - the BEST starting hand in poker! This happens about once every 221 hands.', highlightArea: 'cards' },
      { message: 'You\'re on the BUTTON (BTN) - the best position! You act last after the flop, giving you maximum information.', highlightArea: 'position' },
      { message: 'Someone has raised to $50. The pot is $75. With AA, you should RAISE to build the pot!', highlightArea: 'actions', waitForAction: 'raise', correctAction: 'raise' },
      { message: 'Excellent! Raising with premium hands builds the pot and puts pressure on opponents. Let\'s continue!' }
    ]
  },
  {
    id: 'position',
    title: 'Position Matters',
    description: 'Learn why where you sit changes everything.',
    setupHand: {
      playerCards: [{ rank: 'K', suit: 'spades' }, { rank: 'Q', suit: 'spades' }],
      communityCards: [],
      position: 'UTG',
      pot: 75,
      currentBet: 50,
      street: 'preflop'
    },
    steps: [
      { message: 'Now you\'re Under The Gun (UTG) - the FIRST to act preflop. This is the toughest position!', highlightArea: 'position' },
      { message: 'You have King-Queen suited (KQs) - a good hand, but NOT in early position with a raise to call.', highlightArea: 'cards', showHandStrength: true },
      { message: 'In UTG, you need STRONGER hands because 7 players act after you. Any of them could have a monster!', highlightArea: 'position' },
      { message: 'The correct play here is to FOLD. KQs isn\'t strong enough vs a raise from early position.', highlightArea: 'actions', waitForAction: 'fold', correctAction: 'fold' },
      { message: 'Great discipline! Position awareness separates winners from losers. The same hand plays differently based on where you sit.' }
    ]
  },
  {
    id: 'pot-odds',
    title: 'Pot Odds',
    description: 'The math that makes poker profitable.',
    setupHand: {
      playerCards: [{ rank: '8', suit: 'hearts' }, { rank: '7', suit: 'hearts' }],
      communityCards: [{ rank: 'A', suit: 'hearts' }, { rank: '3', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }],
      position: 'CO',
      pot: 200,
      currentBet: 100,
      street: 'flop'
    },
    steps: [
      { message: 'Now let\'s learn POT ODDS - the most important math concept in poker!', highlightArea: 'pot' },
      { message: 'You have 8♥7♥ and the board shows A♥3♥K♣. You have a FLUSH DRAW - 4 hearts, need 1 more!', highlightArea: 'community', showHandStrength: true },
      { message: 'With 9 hearts left in the deck, you have 9 OUTS. Using the Rule of 4, you have roughly 36% equity (9 × 4).', highlightArea: 'cards', showPotOdds: true },
      { message: 'The pot is $200 and you need to call $100. Your POT ODDS are $100 / $300 = 33%.', highlightArea: 'pot', showPotOdds: true },
      { message: 'Your equity (36%) > pot odds needed (33%). This is a PROFITABLE call! Math says CALL.', highlightArea: 'actions', waitForAction: 'call', correctAction: 'call' },
      { message: 'Perfect! When your chance to win exceeds the price you\'re paying, CALL. This is how pros make money long-term.' }
    ]
  },
  {
    id: 'value-betting',
    title: 'Value Betting',
    description: 'Getting paid with strong hands.',
    setupHand: {
      playerCards: [{ rank: 'A', suit: 'diamonds' }, { rank: 'K', suit: 'diamonds' }],
      communityCards: [{ rank: 'A', suit: 'clubs' }, { rank: '7', suit: 'hearts' }, { rank: '2', suit: 'spades' }, { rank: '9', suit: 'clubs' }],
      position: 'BTN',
      pot: 150,
      currentBet: 0,
      street: 'turn'
    },
    steps: [
      { message: 'Time to learn VALUE BETTING - extracting money from worse hands!', highlightArea: 'pot' },
      { message: 'You have AK on a board of A-7-2-9. You have TOP PAIR with TOP KICKER - a very strong hand!', highlightArea: 'cards', showHandStrength: true },
      { message: 'Your opponent checked. This is your chance to bet for VALUE - to get called by worse hands like A-Q, A-J, or smaller pairs.', highlightArea: 'community' },
      { message: 'If you check, you win nothing extra. If you bet, worse hands might call. RAISE to bet for value!', highlightArea: 'actions', waitForAction: 'raise', correctAction: 'raise' },
      { message: 'Excellent! Betting 50-75% of the pot is standard for value. You want calls from worse hands, not folds!' }
    ]
  },
  {
    id: 'bluffing',
    title: 'Bluffing',
    description: 'Making opponents fold better hands.',
    setupHand: {
      playerCards: [{ rank: '6', suit: 'spades' }, { rank: '5', suit: 'spades' }],
      communityCards: [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }, { rank: '3', suit: 'clubs' }, { rank: '9', suit: 'diamonds' }, { rank: '2', suit: 'hearts' }],
      position: 'BTN',
      pot: 300,
      currentBet: 0,
      street: 'river'
    },
    steps: [
      { message: 'Now for the exciting part - BLUFFING! Making your opponent fold a better hand.', highlightArea: 'cards' },
      { message: 'You have 6-5 suited - complete air (nothing). But you\'ve been betting this hand aggressively...', highlightArea: 'cards', showHandStrength: true },
      { message: 'The board is A♥K♥3♣9♦2♥. Three hearts on board means the flush completed. You DON\'T have it, but you can REPRESENT it!', highlightArea: 'community' },
      { message: 'Your opponent checked. A big bet here tells a story: "I have the flush." If they believe you, they\'ll fold!', highlightArea: 'actions' },
      { message: 'RAISE (bluff)! Bet big like you have the flush. About 75-100% of the pot sells the story.', highlightArea: 'actions', waitForAction: 'raise', correctAction: 'raise' },
      { message: 'Bold! Bluffing is essential - if you never bluff, opponents will only call when they beat you. Balance is key!' }
    ]
  },
  {
    id: 'folding',
    title: 'Knowing When to Fold',
    description: 'Saving money is making money.',
    setupHand: {
      playerCards: [{ rank: 'Q', suit: 'clubs' }, { rank: 'Q', suit: 'diamonds' }],
      communityCards: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }, { rank: '7', suit: 'diamonds' }],
      position: 'MP',
      pot: 500,
      currentBet: 400,
      street: 'turn'
    },
    steps: [
      { message: 'Perhaps the hardest lesson: knowing when to FOLD a good hand.', highlightArea: 'cards' },
      { message: 'You have Queens (QQ) - normally a great hand! But look at this board...', highlightArea: 'cards', showHandStrength: true },
      { message: 'The board shows A♠A♥K♣7♦. Your opponent just bet $400 into a $500 pot (80% pot bet).', highlightArea: 'community' },
      { message: 'They\'re representing at least an Ace or a King. Your Queens are now just a bluff-catcher.', highlightArea: 'pot' },
      { message: 'The math doesn\'t work. You need 44% equity but likely have much less. FOLD and save $400!', highlightArea: 'actions', waitForAction: 'fold', correctAction: 'fold' },
      { message: 'Wise decision! Folding strong hands when beat is what separates winning players from losers. Your QQ was simply second-best here.' }
    ]
  },
  {
    id: 'c-betting',
    title: 'Continuation Betting',
    description: 'Following up preflop aggression.',
    setupHand: {
      playerCards: [{ rank: 'A', suit: 'clubs' }, { rank: 'J', suit: 'clubs' }],
      communityCards: [{ rank: '8', suit: 'hearts' }, { rank: '4', suit: 'diamonds' }, { rank: '2', suit: 'spades' }],
      position: 'CO',
      pot: 120,
      currentBet: 0,
      street: 'flop'
    },
    steps: [
      { message: 'Let\'s learn the C-BET (Continuation Bet) - one of the most common plays in poker.', highlightArea: 'pot' },
      { message: 'You raised preflop with AJ suited. You were the aggressor and your opponent called.', highlightArea: 'cards', showHandStrength: true },
      { message: 'The flop is 8♥4♦2♠. You MISSED completely - no pair, no draw. But your opponent doesn\'t know that!', highlightArea: 'community' },
      { message: 'This dry board (no draws) is PERFECT for a c-bet. It likely missed your opponent too!', highlightArea: 'community' },
      { message: 'By betting, you represent strength and can win the pot right here. RAISE to c-bet!', highlightArea: 'actions', waitForAction: 'raise', correctAction: 'raise' },
      { message: 'Great c-bet! On dry boards, c-betting works ~60%+ of the time. When opponents fold, you win without a showdown!' }
    ]
  },
  {
    id: 'check-raise',
    title: 'The Check-Raise',
    description: 'A powerful trapping play.',
    setupHand: {
      playerCards: [{ rank: 'J', suit: 'spades' }, { rank: 'J', suit: 'hearts' }],
      communityCards: [{ rank: 'J', suit: 'diamonds' }, { rank: '6', suit: 'clubs' }, { rank: '2', suit: 'hearts' }],
      position: 'BB',
      pot: 80,
      currentBet: 0,
      street: 'flop'
    },
    steps: [
      { message: 'Time for a tricky play - the CHECK-RAISE!', highlightArea: 'cards' },
      { message: 'You have JJ and flopped a SET (three of a kind)! This is a monster hand.', highlightArea: 'cards', showHandStrength: true },
      { message: 'You\'re in the Big Blind. If you bet out, aggressive opponents might fold. But if you CHECK...', highlightArea: 'position' },
      { message: 'Your opponent will likely c-bet, thinking you\'re weak. Then you can RAISE and trap them!', highlightArea: 'actions' },
      { message: 'For now, CHECK to set the trap. (In the full game, you\'d then raise their bet!)', highlightArea: 'actions', waitForAction: 'check', correctAction: 'check' },
      { message: 'Perfect trap! Check-raising with monsters extracts maximum value. They\'ve put money in, now they\'re pot-committed!' }
    ]
  }
];

const InteractiveTutorial: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [showingResult, setShowingResult] = useState(false);
  const [playerAction, setPlayerAction] = useState<ActionType | null>(null);
  const [showStageSelect, setShowStageSelect] = useState(true);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());

  const currentStage = INTERACTIVE_STAGES[currentStageIndex];
  const currentStep = currentStage.steps[currentStepIndex];
  const isWaitingForAction = currentStep.waitForAction && !playerAction;
  const isLastStep = currentStepIndex === currentStage.steps.length - 1;

  const handleAction = (action: ActionType) => {
    if (!isWaitingForAction) return;
    setPlayerAction(action);
    setShowingResult(true);
  };

  const handleNext = () => {
    if (showingResult) {
      setShowingResult(false);
      setPlayerAction(null);
    }
    
    if (isLastStep) {
      setCompletedStages(prev => new Set([...prev, currentStage.id]));
      if (currentStageIndex < INTERACTIVE_STAGES.length - 1) {
        setCurrentStageIndex(currentStageIndex + 1);
        setCurrentStepIndex(0);
        setShowStageSelect(true);
      } else {
        setShowStageSelect(true);
      }
    } else {
      setCurrentStepIndex(currentStepIndex + 1);
    }
  };

  const startStage = (index: number) => {
    setCurrentStageIndex(index);
    setCurrentStepIndex(0);
    setPlayerAction(null);
    setShowingResult(false);
    setShowStageSelect(false);
  };

  const getSuitColor = (suit: Suit) => {
    return suit === 'hearts' || suit === 'diamonds' ? 'text-red-500' : 'text-gray-900';
  };

  const getSuitSymbol = (suit: Suit) => {
    const symbols: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    return symbols[suit];
  };

  const renderCard = (card: Card, large = false) => (
    <div className={`${large ? 'w-16 h-24' : 'w-12 h-18'} bg-white rounded-lg shadow-lg flex flex-col items-center justify-center border-2 border-gray-300`}>
      <span className={`${large ? 'text-2xl' : 'text-lg'} font-bold ${getSuitColor(card.suit)}`}>{card.rank}</span>
      <span className={`${large ? 'text-3xl' : 'text-2xl'} ${getSuitColor(card.suit)}`}>{getSuitSymbol(card.suit)}</span>
    </div>
  );

  // Stage Selection Screen
  if (showStageSelect) {
    return (
      <div className="min-h-screen bg-gray-900 p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <PokerIcon name="interactive" size={36} />
              Interactive Poker Tutorial
            </h1>
            <button onClick={onExit} className="px-4 py-2 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937]">
              ← Back to Menu
            </button>
          </div>
          
          <p className="text-gray-400 mb-6">Learn by playing! Each lesson puts you in a real poker situation with guidance.</p>
          
          <div className="grid gap-4">
            {INTERACTIVE_STAGES.map((stage, idx) => (
              <button
                key={stage.id}
                onClick={() => startStage(idx)}
                className={`p-4 rounded-xl text-left transition-all ${
                  completedStages.has(stage.id)
                    ? 'bg-green-900/30 border-2 border-green-600 hover:bg-green-900/50'
                    : 'bg-gray-800 border-2 border-gray-600 hover:border-yellow-500'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{completedStages.has(stage.id) ? '✅' : `${idx + 1}.`}</span>
                      <h3 className="text-xl font-bold text-white">{stage.title}</h3>
                    </div>
                    <p className="text-gray-400 mt-1 ml-10">{stage.description}</p>
                  </div>
                  <span className="text-yellow-400 text-2xl">→</span>
                </div>
              </button>
            ))}
          </div>
          
          <div className="mt-8 p-4 bg-gray-800 rounded-xl border border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-gray-400">Progress: </span>
                <span className="text-white font-bold">{completedStages.size} / {INTERACTIVE_STAGES.length} lessons completed</span>
              </div>
              {completedStages.size === INTERACTIVE_STAGES.length && (
                <span className="text-yellow-400 font-bold flex items-center gap-2">
                  <PokerIcon name="winner" size={20} />
                  Tutorial Complete!
                </span>
              )}
            </div>
            <div className="w-full h-2 bg-gray-700 rounded-full mt-2">
              <div 
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${(completedStages.size / INTERACTIVE_STAGES.length) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-4 border-b border-gray-700">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">{currentStage.title}</h2>
            <p className="text-sm text-gray-400">Step {currentStepIndex + 1} of {currentStage.steps.length}</p>
          </div>
          <button onClick={() => setShowStageSelect(true)} className="px-4 py-2 bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white rounded-lg text-sm transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:translate-y-0 active:shadow-[0_0px_0_0_#1f2937]">
            All Lessons
          </button>
        </div>
      </div>

      {/* Game Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        {/* Table Representation */}
        <div className="relative w-full max-w-2xl aspect-[2/1] bg-green-800 rounded-[100px] border-8 border-green-900 shadow-2xl mb-6">
          {/* Position Indicator */}
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-sm font-bold ${
            currentStep.highlightArea === 'position' ? 'bg-yellow-500 text-black animate-pulse' : 'bg-gray-800 text-white'
          }`}>
            Your Position: {currentStage.setupHand.position}
          </div>

          {/* Community Cards */}
          <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-2 ${
            currentStep.highlightArea === 'community' ? 'ring-4 ring-yellow-500 ring-offset-4 ring-offset-green-800 rounded-lg p-2' : ''
          }`}>
            {currentStage.setupHand.communityCards.length > 0 ? (
              currentStage.setupHand.communityCards.map((card, idx) => (
                <div key={idx}>{renderCard(card)}</div>
              ))
            ) : (
              <div className="text-gray-400 italic">No community cards yet (Preflop)</div>
            )}
          </div>

          {/* Pot */}
          <div className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg ${
            currentStep.highlightArea === 'pot' ? 'bg-yellow-500 text-black animate-pulse' : 'bg-black/50 text-white'
          }`}>
            <span className="font-bold">Pot: ${currentStage.setupHand.pot}</span>
            {currentStage.setupHand.currentBet > 0 && (
              <span className="ml-3 text-sm">To Call: ${currentStage.setupHand.currentBet}</span>
            )}
          </div>

          {/* Street Indicator */}
          <div className="absolute top-4 right-4 px-3 py-1 bg-blue-600 text-white rounded-full text-sm font-bold uppercase">
            {currentStage.setupHand.street}
          </div>
        </div>

        {/* Player Cards */}
        <div className={`flex gap-4 mb-6 p-4 rounded-xl ${
          currentStep.highlightArea === 'cards' ? 'ring-4 ring-yellow-500 bg-gray-800/50' : ''
        }`}>
          <div className="text-center">
            <p className="text-gray-400 text-sm mb-2">Your Cards</p>
            <div className="flex gap-2">
              {currentStage.setupHand.playerCards.map((card, idx) => (
                <div key={idx}>{renderCard(card, true)}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Hand Strength Indicator */}
        {currentStep.showHandStrength && (
          <div className="mb-4 px-4 py-2 bg-blue-900/50 border border-blue-500 rounded-lg">
            <span className="text-blue-300">Hand Strength: </span>
            <span className="text-white font-bold">
              {currentStage.setupHand.playerCards[0].rank === currentStage.setupHand.playerCards[1].rank
                ? `Pair of ${currentStage.setupHand.playerCards[0].rank}s`
                : `${currentStage.setupHand.playerCards[0].rank}${currentStage.setupHand.playerCards[1].rank}${
                    currentStage.setupHand.playerCards[0].suit === currentStage.setupHand.playerCards[1].suit ? ' suited' : ''
                  }`}
            </span>
          </div>
        )}

        {/* Pot Odds Display */}
        {currentStep.showPotOdds && (
          <div className="mb-4 px-4 py-2 bg-purple-900/50 border border-purple-500 rounded-lg">
            <span className="text-purple-300">Pot Odds: </span>
            <span className="text-white font-bold">
              ${currentStage.setupHand.currentBet} to win ${currentStage.setupHand.pot + currentStage.setupHand.currentBet} = {Math.round((currentStage.setupHand.currentBet / (currentStage.setupHand.pot + currentStage.setupHand.currentBet * 2)) * 100)}% needed
            </span>
          </div>
        )}

        {/* Action Buttons */}
        {isWaitingForAction && !showingResult && (
          <div className={`flex gap-4 mb-6 ${currentStep.highlightArea === 'actions' ? 'animate-pulse' : ''}`}>
            <button
              onClick={() => handleAction('fold')}
              className={`px-6 py-3 rounded-xl font-bold transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 ${
                currentStep.correctAction === 'fold'
                  ? 'bg-gradient-to-b from-gray-500 to-gray-700 text-white ring-2 ring-yellow-400 shadow-[0_3px_0_0_#374151,0_4px_8px_rgba(0,0,0,0.3)]'
                  : 'bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 text-white shadow-[0_3px_0_0_#1f2937,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937]'
              }`}
            >
              Fold
            </button>
            {currentStage.setupHand.currentBet === 0 ? (
              <button
                onClick={() => handleAction('check')}
                className={`px-6 py-3 rounded-xl font-bold transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 ${
                  currentStep.correctAction === 'check'
                    ? 'bg-gradient-to-b from-sky-500 to-sky-700 text-white ring-2 ring-yellow-400 shadow-[0_3px_0_0_#0369a1,0_4px_8px_rgba(0,0,0,0.3)]'
                    : 'bg-gradient-to-b from-sky-600 to-sky-800 hover:from-sky-500 hover:to-sky-700 text-white shadow-[0_3px_0_0_#075985,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#075985]'
                }`}
              >
                Check
              </button>
            ) : (
              <button
                onClick={() => handleAction('call')}
                className={`px-6 py-3 rounded-xl font-bold transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 ${
                  currentStep.correctAction === 'call'
                    ? 'bg-gradient-to-b from-sky-500 to-sky-700 text-white ring-2 ring-yellow-400 shadow-[0_3px_0_0_#0369a1,0_4px_8px_rgba(0,0,0,0.3)]'
                    : 'bg-gradient-to-b from-sky-600 to-sky-800 hover:from-sky-500 hover:to-sky-700 text-white shadow-[0_3px_0_0_#075985,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#075985]'
                }`}
              >
                Call ${currentStage.setupHand.currentBet}
              </button>
            )}
            <button
              onClick={() => handleAction('raise')}
              className={`px-6 py-3 rounded-xl font-bold transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 ${
                currentStep.correctAction === 'raise'
                  ? 'bg-gradient-to-b from-amber-400 to-amber-600 text-gray-900 ring-2 ring-yellow-400 shadow-[0_3px_0_0_#b45309,0_4px_8px_rgba(0,0,0,0.3)]'
                  : 'bg-gradient-to-b from-amber-500 to-amber-700 hover:from-amber-400 hover:to-amber-600 text-gray-900 shadow-[0_3px_0_0_#92400e,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#92400e]'
              }`}
            >
              Raise
            </button>
          </div>
        )}

        {/* Result Feedback */}
        {showingResult && (
          <div className={`mb-6 p-4 rounded-xl max-w-lg text-center ${
            playerAction === currentStep.correctAction ? 'bg-green-900/50 border-2 border-green-500' : 'bg-yellow-900/50 border-2 border-yellow-500'
          }`}>
            {playerAction === currentStep.correctAction ? (
              <>
                <span className="text-3xl">✅</span>
                <p className="text-green-400 font-bold mt-2">Correct!</p>
              </>
            ) : (
              <>
                <span className="text-3xl">💡</span>
                <p className="text-yellow-400 font-bold mt-2">
                  The optimal play was to {currentStep.correctAction}
                </p>
              </>
            )}
            {currentStep.explanation && <p className="text-gray-300 mt-2">{currentStep.explanation}</p>}
          </div>
        )}

        {/* Message Box */}
        <div className="bg-gray-800 border-2 border-gray-600 rounded-xl p-6 max-w-lg text-center">
          <p className="text-white text-lg leading-relaxed">{currentStep.message}</p>
          
          {(!isWaitingForAction || showingResult) && (
            <button
              onClick={handleNext}
              className="mt-4 px-8 py-3 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-lg transition-all"
            >
              {isLastStep ? 'Complete Lesson →' : 'Continue →'}
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-gray-800 p-4 border-t border-gray-700">
        <div className="max-w-4xl mx-auto">
          <div className="w-full h-2 bg-gray-700 rounded-full">
            <div 
              className="h-full bg-yellow-500 rounded-full transition-all"
              style={{ width: `${((currentStepIndex + 1) / currentStage.steps.length) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Helper Components ---

const PlayingCard: React.FC<{ card: Card; className?: string; showCard?: boolean }> = ({ card, className = '', showCard = true }) => {
  if (card.hidden && !showCard) {
    return (
      <div
        className={`w-10 h-14 sm:w-12 sm:h-16 bg-gradient-to-br from-blue-700 to-blue-900 border-2 border-blue-400 rounded-lg shadow-md ${className}`}
        aria-label="Hidden Card"
      >
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-6 h-8 border border-blue-400 rounded opacity-50"></div>
        </div>
      </div>
    );
  }

  const displayCard = card.hidden && showCard ? { ...card, hidden: false } : card;
  const isRed = displayCard.suit === 'hearts';
  const isBlue = displayCard.suit === 'diamonds';
  const isGreen = displayCard.suit === 'clubs';
  const suitIcon = {
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    spades: '♠'
  }[displayCard.suit];

  const colorClass = isRed ? 'text-red-600' : isBlue ? 'text-blue-600' : isGreen ? 'text-green-600' : 'text-gray-900';

  return (
    <div
      className={`
        w-10 h-14 sm:w-12 sm:h-16 bg-white rounded-lg shadow-md flex flex-col items-center justify-center
        border border-gray-300 select-none ${className}
      `}
      aria-label={`${displayCard.rank} of ${displayCard.suit}`}
    >
      <span className={`text-sm sm:text-base font-bold ${colorClass}`}>
        {displayCard.rank}
      </span>
      <span className={`text-lg sm:text-xl leading-none ${colorClass}`}>
        {suitIcon}
      </span>
    </div>
  );
};

const PlayerSeat: React.FC<{ player: Player; style: React.CSSProperties; showHiddenCards?: boolean }> = ({ player, style, showHiddenCards = false }) => {
  // User (position 0) gets highest z-index
  const zIndex = player.position === 0 ? 30 : 20;

  return (
    <div
      className={`absolute flex flex-col items-center transition-all duration-300 ${player.isFolded ? 'opacity-50 grayscale' : ''}`}
      style={{ ...style, zIndex }}
    >
      {/* Cards - Show user's cards even after folding so they can follow along */}
      {(!player.isFolded || player.position === 0) && (
        <div className="flex -space-x-4 mb-2">
          {player.cards.map((card, idx) => (
            <PlayingCard
              key={idx}
              card={card}
              showCard={showHiddenCards || !card.hidden}
              className={`transform ${idx === 0 ? '-rotate-6' : 'rotate-6'} origin-bottom`}
            />
          ))}
        </div>
      )}

      {/* Avatar Circle */}
      <div className={`
        relative w-14 h-14 rounded-full border-4 flex items-center justify-center bg-gray-800 text-white shadow-lg
        ${player.isActive ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)] animate-pulse' : 'border-gray-600'}
      `}>
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>

        {/* Dealer Button */}
        {player.isDealer && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 text-black rounded-full flex items-center justify-center border border-yellow-600 font-bold text-xs shadow-sm z-20">
            D
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="mt-1 bg-gray-900/90 text-white px-2 py-1 rounded-lg text-center border border-gray-700 shadow-md min-w-[90px]">
        <div className="text-xs font-semibold truncate">{player.positionName}</div>
        <div className="text-xs text-green-400">${player.chips.toLocaleString()}</div>
      </div>

      {/* Current Bet Bubble */}
      {player.currentBet > 0 && (
        <div className="absolute -bottom-6 bg-yellow-100 text-yellow-900 text-xs font-bold px-2 py-0.5 rounded-full border border-yellow-300 shadow-sm">
          ${player.currentBet}
        </div>
      )}
    </div>
  );
};

const ActionControls: React.FC<{
  onFold: () => void;
  onCheck: () => void;
  onCall: () => void;
  onRaise: (amount: number) => void;
  callAmount: number;
  minRaise: number;
  maxRaise: number;
  canCheck: boolean;
  disabled: boolean;
  smallBlind: number;
  bigBlind: number;
  pot: number;
}> = ({ onFold, onCheck, onCall, onRaise, callAmount, minRaise, maxRaise, canCheck, disabled, smallBlind, bigBlind, pot }) => {
  const [raiseAmount, setRaiseAmount] = useState(minRaise);

  useEffect(() => {
    setRaiseAmount(minRaise);
  }, [minRaise]);

  const presetRaises = [
    { label: '2x', amount: bigBlind * 2 },
    { label: '3x', amount: bigBlind * 3 },
    { label: '1/2 Pot', amount: Math.floor(pot / 2) },
    { label: 'Pot', amount: pot },
    { label: 'All-In', amount: maxRaise },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900 via-gray-900 to-gray-900/95 border-t border-gray-700/50 p-4 z-50 backdrop-blur-sm">
      <div className="max-w-4xl mx-auto flex flex-col gap-3">
        {/* Raise presets */}
        <div className="flex justify-center gap-2 flex-wrap">
          {presetRaises.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setRaiseAmount(Math.min(Math.max(preset.amount, minRaise), maxRaise))}
              disabled={disabled}
              className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 ${
                preset.label === 'All-In'
                  ? 'bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white shadow-[0_2px_0_0_#991b1b,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#991b1b] active:shadow-[0_0px_0_0_#991b1b] disabled:shadow-none disabled:transform-none'
                  : 'bg-gradient-to-b from-gray-600 to-gray-800 hover:from-gray-500 hover:to-gray-700 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white shadow-[0_2px_0_0_#1f2937,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#1f2937] active:shadow-[0_0px_0_0_#1f2937] disabled:shadow-none disabled:transform-none'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Slider and Actions */}
        <div className="flex items-center justify-center gap-4">
          {/* Slider */}
          <div className="flex items-center gap-2 w-48">
            <span className="text-white text-xs">${minRaise}</span>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              step={bigBlind}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
              disabled={disabled}
            />
            <span className="text-white text-xs">${maxRaise}</span>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onFold}
              disabled={disabled}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-gray-500 to-gray-700 hover:from-gray-400 hover:to-gray-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-semibold transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_3px_0_0_#374151,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#374151,0_2px_4px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_0px_0_0_#374151] disabled:shadow-none disabled:transform-none"
            >
              Fold
            </button>

            {canCheck ? (
              <button
                onClick={onCheck}
                disabled={disabled}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 hover:from-sky-400 hover:to-sky-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-semibold transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_3px_0_0_#0369a1,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#0369a1,0_2px_4px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_0px_0_0_#0369a1] disabled:shadow-none disabled:transform-none"
              >
                Check
              </button>
            ) : (
              <button
                onClick={onCall}
                disabled={disabled}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-b from-sky-500 to-sky-700 hover:from-sky-400 hover:to-sky-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-semibold transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_3px_0_0_#0369a1,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#0369a1,0_2px_4px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_0px_0_0_#0369a1] disabled:shadow-none disabled:transform-none"
              >
                Call ${callAmount}
              </button>
            )}

            <button
              onClick={() => onRaise(raiseAmount)}
              disabled={disabled}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-gray-900 font-bold transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_3px_0_0_#b45309,0_4px_8px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#b45309,0_2px_4px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_0px_0_0_#b45309] disabled:shadow-none disabled:transform-none min-w-[120px]"
            >
              Raise ${raiseAmount}
            </button>
          </div>

          {/* Pot & Blinds */}
          <div className="flex items-center gap-2 text-xs">
            <div className="bg-gray-800 px-2 py-1 rounded text-white font-mono border border-gray-700">
              <span className="text-gray-400">Blinds:</span>{' '}
              <span className="text-yellow-400">${smallBlind}/${bigBlind}</span>
            </div>
            <div className="bg-gray-800 px-2 py-1 rounded text-white font-mono border border-gray-700">
              <span className="text-gray-400">Pot:</span>{' '}
              <span className="text-green-400 font-bold">${pot}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Pot Odds Info Component ---
const PotOddsInfo: React.FC<{
  pot: number;
  callAmount: number;
  street: Street;
  isUserTurn: boolean;
}> = ({ pot, callAmount, street, isUserTurn }) => {
  if (callAmount <= 0 || !isUserTurn) return null;

  const totalPot = pot + callAmount;
  const potOdds = (callAmount / totalPot) * 100;
  const requiredEquity = potOdds;

  // Get tip based on pot odds
  const getPotOddsTip = (): { tip: string; color: string; hands: string } => {
    if (potOdds <= 20) {
      return {
        tip: "Excellent pot odds! You only need ~20% equity to call profitably.",
        color: "text-green-400",
        hands: "Call with: Any pair, any draw (flush/straight), two overcards, suited connectors. Even weak draws are profitable here!"
      };
    } else if (potOdds <= 25) {
      return {
        tip: "Good pot odds. You need ~25% equity - many drawing hands qualify.",
        color: "text-green-300",
        hands: "Call with: Pairs, flush draws (35% equity), open-ended straight draws (31%), gutshots with overcards."
      };
    } else if (potOdds <= 33) {
      return {
        tip: "Decent pot odds. You need ~33% equity to break even.",
        color: "text-yellow-400",
        hands: "Call with: Strong draws (flush+pair, combo draws), medium pairs, top pair weak kicker. Fold weak gutshots."
      };
    } else if (potOdds <= 40) {
      return {
        tip: "Marginal pot odds. You need ~40% equity - be selective.",
        color: "text-orange-400",
        hands: "Call with: Strong made hands (top pair good kicker+), nut flush draws, strong combo draws. Fold most speculative hands."
      };
    } else {
      return {
        tip: "Poor pot odds. You need 40%+ equity - only continue with strong hands.",
        color: "text-red-400",
        hands: "Call with: Two pair+, sets, nut draws only. Fold marginal hands - the price is too high!"
      };
    }
  };

  const getDrawOdds = (): string => {
    if (street === 'preflop') {
      return "Preflop: Focus on hand strength and position. Premium pairs (AA-QQ) ~80% vs random hand.";
    } else if (street === 'flop') {
      return "Common draws (2 cards to come): Flush draw ~35%, OESD ~31%, Gutshot ~17%, Overcards ~24%";
    } else if (street === 'turn') {
      return "Common draws (1 card to come): Flush draw ~19%, OESD ~17%, Gutshot ~9%, Overcards ~13%";
    }
    return "River: No more cards - you either have the best hand or you don't!";
  };

  const { tip, color, hands } = getPotOddsTip();

  return (
    <div className="absolute left-4 bottom-36 w-80 bg-gray-900/95 rounded-lg border border-gray-700 p-3 z-40">
      <div className="text-xs space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 pb-2">
          <span className="text-white font-bold">📊 Pot Odds Calculator</span>
          <span className={`font-mono font-bold ${color}`}>{potOdds.toFixed(1)}%</span>
        </div>

        {/* Calculation Breakdown */}
        <div className="bg-gray-800 rounded p-2 font-mono text-gray-300">
          <div className="text-[10px] text-gray-500 mb-1">CALCULATION:</div>
          <div>Call ${callAmount} ÷ (Pot ${pot} + Call ${callAmount})</div>
          <div>= ${callAmount} ÷ ${totalPot} = <span className={color}>{potOdds.toFixed(1)}%</span></div>
        </div>

        {/* What this means */}
        <div className="bg-gray-800/50 rounded p-2">
          <div className="text-[10px] text-gray-500 mb-1">WHAT THIS MEANS:</div>
          <p className={color}>{tip}</p>
          <p className="text-gray-400 mt-1">You need to win {requiredEquity.toFixed(0)}% of the time to break even on this call.</p>
        </div>

        {/* Recommended hands */}
        <div className="bg-gray-800/50 rounded p-2">
          <div className="text-[10px] text-gray-500 mb-1">RECOMMENDED HANDS:</div>
          <p className="text-gray-300">{hands}</p>
        </div>

        {/* Draw odds reference */}
        <div className="bg-blue-900/30 rounded p-2 border border-blue-800/50">
          <div className="text-[10px] text-blue-400 mb-1">📈 DRAW ODDS REFERENCE:</div>
          <p className="text-blue-300">{getDrawOdds()}</p>
        </div>

        {/* Quick decision */}
        <div className="text-center pt-1 border-t border-gray-700">
          {potOdds <= 33 ? (
            <span className="text-green-400 font-bold">✓ Good price to draw</span>
          ) : (
            <span className="text-orange-400 font-bold">⚠ Need strong hand/draw</span>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Action Log Component ---
const ActionLog: React.FC<{
  actions: ActionLogEntry[];
  expanded: boolean;
  onToggle: () => void;
  positionTip: string;
  optimalPlay: {
    recommendation: string;
    position: Position;
    potOdds: number;
    handStrength: number;
    street: Street;
    facingBet: boolean;
    callAmount: number;
    pot: number;
  } | null;
}> = ({ actions, expanded, onToggle, positionTip, optimalPlay }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [showPositionChart, setShowPositionChart] = useState(false);

  const positionData = [
    { abbr: 'BTN', name: 'Button (Dealer)', color: 'text-yellow-400', desc: 'Best position. Acts last postflop. Can play widest range.' },
    { abbr: 'SB', name: 'Small Blind', color: 'text-red-400', desc: 'Worst position. Posts half blind, acts first postflop. Play tight.' },
    { abbr: 'BB', name: 'Big Blind', color: 'text-red-300', desc: 'Posts full blind. Gets to act last preflop. Defend vs steals.' },
    { abbr: 'UTG', name: 'Under the Gun', color: 'text-orange-400', desc: 'First to act preflop. Play very tight (top 10-15% hands).' },
    { abbr: 'UTG+1', name: 'UTG+1', color: 'text-orange-300', desc: 'Second to act preflop. Still very early, play tight (top 12-18%).' },
    { abbr: 'MP', name: 'Middle Position', color: 'text-blue-400', desc: 'Middle ground. Slightly wider than UTG (top 15-20%).' },
    { abbr: 'HJ', name: 'Hijack', color: 'text-purple-400', desc: 'Two before button. Can start opening wider (top 20-25%).' },
    { abbr: 'CO', name: 'Cutoff', color: 'text-green-400', desc: 'One before button. Very strong position (top 25-30%).' },
  ];

  return (
    <div className={`absolute right-4 top-4 ${expanded ? 'w-96' : 'w-64'} bg-black/80 rounded-lg border border-gray-700 overflow-hidden transition-all`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-300 font-bold">Action Log</span>
        <button
          onClick={onToggle}
          className="text-xs text-blue-400 hover:text-blue-300"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Actions */}
      <div className={`${expanded ? 'max-h-48' : 'max-h-32'} overflow-y-auto p-2`}>
        {actions.slice(-(expanded ? 20 : 8)).map((action, idx) => (
          <div
            key={idx}
            className="relative text-xs text-white py-1 px-2 hover:bg-gray-800 rounded cursor-help"
            onMouseEnter={() => setHoveredIdx(idx)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            {action.message}
            {/* Tooltip with optimal action */}
            {hoveredIdx === idx && action.optimalAction && (
              <div className="absolute left-0 top-full mt-1 z-50 w-64 p-2 bg-blue-900 border border-blue-500 rounded shadow-lg">
                <div className="text-yellow-300 font-bold text-xs mb-1">Optimal Play:</div>
                <div className="text-white text-xs">{action.optimalAction}</div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Current Optimal Play Recommendation */}
      {optimalPlay && (
        <div className="border-t border-green-700 p-3 bg-green-900/30">
          <div className="text-green-400 text-xs font-bold mb-2 flex items-center gap-1">
            <span className="flex items-center gap-1"><PokerIcon name="practice" size={16} /> OPTIMAL PLAY NOW ({optimalPlay.position})</span>
          </div>
          <div className="text-white text-sm font-bold mb-2 leading-snug">
            {optimalPlay.recommendation}
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <div className="bg-gray-800 rounded px-2 py-1">
              <span className="text-gray-400">Hand Strength:</span>{' '}
              <span className={optimalPlay.handStrength >= 60 ? 'text-green-400' : optimalPlay.handStrength >= 30 ? 'text-yellow-400' : 'text-red-400'}>
                {optimalPlay.handStrength.toFixed(0)}%
              </span>
            </div>
            <div className="bg-gray-800 rounded px-2 py-1">
              <span className="text-gray-400">Pot Odds:</span>{' '}
              <span className={optimalPlay.potOdds <= 25 ? 'text-green-400' : optimalPlay.potOdds <= 35 ? 'text-yellow-400' : 'text-red-400'}>
                {optimalPlay.potOdds.toFixed(1)}%
              </span>
            </div>
            <div className="bg-gray-800 rounded px-2 py-1">
              <span className="text-gray-400">Street:</span>{' '}
              <span className="text-blue-300 capitalize">{optimalPlay.street}</span>
            </div>
            <div className="bg-gray-800 rounded px-2 py-1">
              <span className="text-gray-400">Situation:</span>{' '}
              <span className="text-purple-300">{optimalPlay.facingBet ? `Facing $${optimalPlay.callAmount}` : 'Can check'}</span>
            </div>
          </div>
          {/* Why this is optimal */}
          <div className="mt-2 text-[10px] text-gray-400 bg-gray-800/50 rounded p-2">
            <span className="text-gray-500 font-bold">WHY: </span>
            {optimalPlay.handStrength >= 70 ? (
              'Strong hand - build the pot for value!'
            ) : optimalPlay.handStrength >= 50 ? (
              optimalPlay.facingBet
                ? optimalPlay.potOdds <= 30 ? 'Decent hand with good pot odds - profitable call.' : 'Marginal spot - consider position and opponent tendencies.'
                : 'Medium strength - bet for value or protection.'
            ) : optimalPlay.handStrength >= 30 ? (
              optimalPlay.facingBet
                ? optimalPlay.potOdds <= 25 ? 'Drawing hand with good odds - call to see more cards.' : 'Weak hand facing aggression - usually fold.'
                : optimalPlay.position === 'BTN' || optimalPlay.position === 'CO' ? 'Late position - can bet as a semi-bluff.' : 'Check and see a free card.'
            ) : (
              optimalPlay.facingBet
                ? 'Weak hand - fold and wait for a better spot.'
                : 'Check - no value in betting with this hand.'
            )}
          </div>
        </div>
      )}

      {/* Position Strategy Tip */}
      {expanded && (
        <div className="border-t border-gray-700 p-2 bg-gray-900/50">
          <div className="text-yellow-400 text-xs font-bold mb-1 flex items-center gap-1">
            <PokerIcon name="position" size={14} /> Position Strategy ({optimalPlay?.position || 'General'}):
          </div>
          <div className="text-gray-300 text-xs leading-relaxed">{positionTip}</div>
        </div>
      )}

      {/* Position Chart Toggle */}
      <div className="border-t border-gray-700 px-3 py-2 bg-gray-800/50">
        <button
          onClick={() => setShowPositionChart(!showPositionChart)}
          className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 w-full justify-center"
        >
          {showPositionChart ? '▼ Hide' : '▶ Show'} Position Chart
        </button>
      </div>

      {/* Position Chart */}
      {showPositionChart && (
        <div className="border-t border-cyan-700 p-3 bg-cyan-900/20 max-h-64 overflow-y-auto">
          <div className="text-cyan-400 text-xs font-bold mb-2">📊 Position Reference (8-handed)</div>
          <div className="text-[10px] text-gray-400 mb-3">
            Order of action preflop: UTG → UTG+1 → MP → HJ → CO → BTN → SB → BB
          </div>
          <div className="space-y-2">
            {positionData.map((pos) => (
              <div key={pos.abbr} className="bg-gray-800/60 rounded p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-bold ${pos.color}`}>{pos.abbr}</span>
                  <span className="text-gray-300 text-xs">{pos.name}</span>
                </div>
                <div className="text-gray-400 text-[10px] leading-relaxed">{pos.desc}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 p-2 bg-gray-800 rounded text-[10px] text-gray-400">
            <span className="text-yellow-400 font-bold">💡 Tip:</span> Position is EVERYTHING in poker.
            Late position (CO, BTN) can see what others do first, giving a huge information advantage.
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main Component ---

const PokerTable: React.FC = () => {
  // Blind structure - increases every 5 hands in full game mode
  const blindLevels = [
    { sb: 25, bb: 50 },
    { sb: 50, bb: 100 },
    { sb: 75, bb: 150 },
    { sb: 100, bb: 200 },
    { sb: 150, bb: 300 },
    { sb: 200, bb: 400 },
    { sb: 300, bb: 600 },
    { sb: 400, bb: 800 },
    { sb: 500, bb: 1000 },
    { sb: 750, bb: 1500 },
  ];
  const handsPerLevel = 5;

  const [gameStarted, setGameStarted] = useState(false);
  const [tutorialMode, setTutorialMode] = useState(false);
  const [interactiveTutorial, setInteractiveTutorial] = useState(false);
  const [replayMode, setReplayMode] = useState(false);
  const [showAllHands, setShowAllHands] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [fullGameMode, setFullGameMode] = useState(false);
  const [dealerIndex, setDealerIndex] = useState(0);
  const [handNumber, setHandNumber] = useState(1);
  const [handWinner, setHandWinner] = useState<string | null>(null);
  const [gameWinner, setGameWinner] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [blindLevel, setBlindLevel] = useState(0);

  // Calculate current blinds based on level
  const currentBlinds = blindLevels[Math.min(blindLevel, blindLevels.length - 1)];
  const smallBlind = currentBlinds.sb;
  const bigBlind = currentBlinds.bb;

  const positionOrder: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'];

  const initializeGame = useCallback((existingChips?: number[], btnIndex?: number) => {
    const deck = createDeck();
    const dealerIdx = btnIndex ?? Math.floor(Math.random() * 8);

    // Position names relative to dealer
    const getPositionName = (seatIndex: number): Position => {
      const offset = (seatIndex - dealerIdx + 8) % 8;
      return positionOrder[offset];
    };

    const baseChips = existingChips || [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

    // Find first-to-act (UTG or first non-eliminated player after BB)
    // Position order from dealer: BTN(0), SB(1), BB(2), UTG(3), MP(4), CO(5), HJ(6)
    // Preflop action starts at UTG (offset 3 from dealer)
    let firstToActIdx = -1;
    for (let i = 0; i < 7; i++) {
      const seatIdx = (dealerIdx + 3 + i) % 8; // Start at UTG position
      if (baseChips[seatIdx] > 0) {
        firstToActIdx = seatIdx;
        break;
      }
    }

    const initialPlayers: Player[] = baseChips.map((chips, idx) => {
      const posName = getPositionName(idx);
      const isSB = posName === 'SB';
      const isBB = posName === 'BB';
      const isDealer = posName === 'BTN';
      const isHuman = idx === 0;

      // Handle blinds
      let playerChips = chips;
      let currentBet = 0;
      if (isSB && chips >= smallBlind) {
        playerChips = chips - smallBlind;
        currentBet = smallBlind;
      } else if (isBB && chips >= bigBlind) {
        playerChips = chips - bigBlind;
        currentBet = bigBlind;
      }

      return {
        id: String(idx + 1),
        name: isHuman ? 'You' : 'AI',
        positionName: posName,
        chips: playerChips,
        position: idx,
        isActive: idx === firstToActIdx && chips > 0,
        isDealer,
        isFolded: chips <= 0, // Eliminated players are folded
        currentBet,
        hasActed: chips <= 0, // Eliminated players count as already acted
        cards: chips > 0
          ? dealCards(deck, 2).map(c => isHuman ? c : { ...c, hidden: true })
          : []
      };
    });

    const sbPlayer = initialPlayers.find(p => p.positionName === 'SB');
    const bbPlayer = initialPlayers.find(p => p.positionName === 'BB');

    return {
      players: initialPlayers,
      gameState: {
        pot: (sbPlayer?.currentBet || 0) + (bbPlayer?.currentBet || 0),
        communityCards: [] as Card[],
        street: 'preflop' as Street,
        currentBet: bigBlind,
        minRaise: bigBlind * 2,
        deck
      },
      actionLog: [
        { message: `--- Hand #${handNumber} ---`, playerPosition: 'BTN' as Position, action: 'check' as ActionType },
        { message: `SB posts $${smallBlind}`, playerPosition: 'SB' as Position, action: 'raise' as ActionType, amount: smallBlind },
        { message: `BB posts $${bigBlind}`, playerPosition: 'BB' as Position, action: 'raise' as ActionType, amount: bigBlind },
      ],
      dealerIndex: dealerIdx
    };
  }, [handNumber]);

  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>({
    pot: 0,
    communityCards: [],
    street: 'preflop',
    currentBet: bigBlind,
    minRaise: bigBlind * 2,
    deck: []
  });
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  
  // Advanced AI: Track opponent statistics for exploitative play
  const [playerStats, setPlayerStats] = useState<Record<string, PlayerStats>>({});
  

  // Update player stats based on action
  const updatePlayerStats = useCallback((playerId: string, action: ActionType, amount: number, street: Street, pot: number) => {
    setPlayerStats(prev => {
      const stats = prev[playerId] || createEmptyStats();
      const newStats = { ...stats };

      if (street === 'preflop' && (action === 'call' || action === 'raise')) {
        newStats.handsPlayed++;
        newStats.oddsPlayedPreflop = (newStats.handsPlayed / Math.max(1, handNumber)) * 100;
      }

      switch (action) {
        case 'fold':
          newStats.folds++;
          break;
        case 'call':
          newStats.calls++;
          break;
        case 'raise':
        case 'all-in':
          newStats.raises++;
          if (street === 'preflop') {
            newStats.preflopRaises++;
          }
          if (amount > 0 && pot > 0) {
            newStats.totalBetAmount += (amount / pot);
            newStats.betCount++;
            newStats.avgBetSize = newStats.totalBetAmount / newStats.betCount;
          }
          break;
      }

      // Update aggression factor
      const totalActions = newStats.bets + newStats.raises + newStats.calls;
      newStats.aggression = totalActions > 0 ? (newStats.bets + newStats.raises) / Math.max(1, newStats.calls) : 1;

      return { ...prev, [playerId]: newStats };
    });
  }, [handNumber]);

  const startNewGame = (isFullGame = false) => {
    const { players: p, gameState: g, actionLog: a, dealerIndex: d } = initializeGame();
    setPlayers(p);
    setGameState(g);
    setActionLog(a);
    setDealerIndex(d);
    setGameStarted(true);
    setReplayMode(false);
    setShowAllHands(false);
    setFullGameMode(isFullGame);
    setHandNumber(1);
    setHandWinner(null);
    setGameWinner(null);
    setBlindLevel(0); // Reset blinds for new game
  };

  const startNextHand = useCallback(() => {
    // Get current chip counts
    const chipCounts = players.map(p => p.chips + p.currentBet);

    // Check for game winner (only one player with chips)
    const playersWithChips = chipCounts.filter(c => c > 0);
    if (playersWithChips.length <= 1) {
      const winnerIdx = chipCounts.findIndex(c => c > 0);
      const winner = players[winnerIdx];
      setGameWinner(winner?.name === 'You' ? 'You win the game!' : `${winner?.positionName} (AI) wins the game!`);
      return;
    }

    // Rotate dealer button
    let newDealerIdx = (dealerIndex + 1) % 8;
    // Skip eliminated players
    while (chipCounts[newDealerIdx] <= 0) {
      newDealerIdx = (newDealerIdx + 1) % 8;
    }

    const nextHandNumber = handNumber + 1;
    setHandNumber(nextHandNumber);
    setHandWinner(null);

    // Increase blinds every N hands
    const newBlindLevel = Math.floor((nextHandNumber - 1) / handsPerLevel);
    if (newBlindLevel !== blindLevel) {
      setBlindLevel(newBlindLevel);
    }

    const { players: p, gameState: g, actionLog: a } = initializeGame(chipCounts, newDealerIdx);
    setPlayers(p);
    setGameState(g);
    setActionLog(a);
    setDealerIndex(newDealerIdx);
    setReplayMode(false);
    setShowAllHands(false);
  }, [players, dealerIndex, handNumber, blindLevel, handsPerLevel, initializeGame]);

  // Auto-continue to next hand in full game mode
  useEffect(() => {
    if (fullGameMode && handWinner && !gameWinner && !isPaused) {
      const timer = setTimeout(() => {
        startNextHand();
      }, 2500); // 2.5 second delay to see the winner
      return () => clearTimeout(timer);
    }
  }, [fullGameMode, handWinner, gameWinner, isPaused, startNextHand]);

  const activePlayer = players.find(p => p.isActive);
  const userPlayer = players.find(p => p.position === 0);
  const isUserTurn = activePlayer?.position === 0;

  // Get current position tip
  const currentPositionTip = userPlayer
    ? getPositionStrategy(userPlayer.positionName, gameState.street)
    : 'Start a game to see position tips.';

  // Compute optimal play for current situation
  const currentOptimalPlay = useMemo(() => {
    if (!isUserTurn || !userPlayer || replayMode) return null;

    const handStrength = evaluateBoardStrength(userPlayer.cards, gameState.communityCards);
    const callAmount = gameState.currentBet - userPlayer.currentBet;
    const potOdds = callAmount > 0 ? (callAmount / (gameState.pot + callAmount)) * 100 : 0;
    const facingBet = callAmount > 0;

    const recommendation = getOptimalAction(
      handStrength,
      userPlayer.positionName,
      gameState.street,
      potOdds,
      facingBet,
      gameState.currentBet
    );

    return {
      recommendation,
      position: userPlayer.positionName,
      potOdds,
      handStrength,
      street: gameState.street,
      facingBet,
      callAmount,
      pot: gameState.pot
    };
  }, [isUserTurn, userPlayer, replayMode, gameState]);

  const advanceStreet = useCallback(() => {
    setGameState(prev => {
      const newCommunityCards = [...prev.communityCards];
      let newStreet = prev.street;
      let streetName = '';

      if (prev.street === 'preflop') {
        newCommunityCards.push(...dealCards(prev.deck, 3));
        newStreet = 'flop';
        streetName = 'Flop';
      } else if (prev.street === 'flop') {
        newCommunityCards.push(...dealCards(prev.deck, 1));
        newStreet = 'turn';
        streetName = 'Turn';
      } else if (prev.street === 'turn') {
        newCommunityCards.push(...dealCards(prev.deck, 1));
        newStreet = 'river';
        streetName = 'River';
      } else if (prev.street === 'river') {
        newStreet = 'showdown';
        streetName = 'Showdown';
      }

      setActionLog(log => [...log, {
        message: `--- ${streetName} ---`,
        playerPosition: 'BTN' as Position,
        action: 'check' as ActionType
      }]);

      return {
        ...prev,
        communityCards: newCommunityCards,
        street: newStreet,
        currentBet: 0,
        minRaise: bigBlind
      };
    });

    // Reset hasActed and currentBet for new street
    setPlayers(prev => {
      const activePlayers = prev.filter(p => !p.isFolded && p.chips > 0);
      if (activePlayers.length <= 1) {
        // If only 1 or 0 active players with chips, no betting needed
        return prev.map(p => ({
          ...p,
          hasActed: true,
          currentBet: 0,
          isActive: false
        }));
      }

      // Find dealer position
      const dealerIdx = prev.findIndex(p => p.isDealer);

      // First to act postflop is first non-folded, non-all-in player after dealer (SB position)
      let firstToAct = (dealerIdx + 1) % prev.length;
      let attempts = 0;
      while ((prev[firstToAct].isFolded || prev[firstToAct].chips === 0) && attempts < 7) {
        firstToAct = (firstToAct + 1) % prev.length;
        attempts++;
      }

      return prev.map((p, idx) => ({
        ...p,
        hasActed: p.isFolded || p.chips === 0, // Folded and all-in players count as acted
        currentBet: 0,
        isActive: idx === firstToAct && !p.isFolded && p.chips > 0
      }));
    });
  }, [bigBlind]);

  const processAction = useCallback((action: ActionType, amount: number = 0) => {
    const currentActive = players.find(p => p.isActive);
    if (!currentActive) return;

    // Don't process if player has no chips (already all-in or eliminated)
    if (currentActive.chips <= 0 && action !== 'fold' && action !== 'check') {
      // Auto-check if can't bet
      if (gameState.currentBet <= currentActive.currentBet) {
        // Can check - process as check
      } else {
        // Must fold or is all-in - skip to next player
        return;
      }
    }

    const playerName = `${currentActive.positionName}`;
    const handStrength = evaluateBoardStrength(
      currentActive.cards.map(c => ({ ...c, hidden: false })),
      gameState.communityCards
    );
    const potOdds = gameState.pot > 0 ? (gameState.currentBet / (gameState.pot + gameState.currentBet)) * 100 : 0;
    const facingBet = gameState.currentBet > currentActive.currentBet;

    let logMessage = '';
    let potAdd = 0;
    let actualBetTo = 0;
    let isAllIn = false;

    if (action === 'fold') {
      logMessage = `${playerName} folds`;
    } else if (action === 'check') {
      logMessage = `${playerName} checks`;
    } else if (action === 'call') {
      const neededToCall = gameState.currentBet - currentActive.currentBet;
      // Cap at player's chips (all-in)
      const callAmt = Math.min(neededToCall, currentActive.chips);
      isAllIn = callAmt >= currentActive.chips;
      potAdd = callAmt;
      actualBetTo = currentActive.currentBet + callAmt;
      logMessage = isAllIn ? `${playerName} calls ALL-IN $${callAmt}` : `${playerName} calls $${callAmt}`;
    } else if (action === 'raise') {
      // Cap raise at player's total chips + current bet
      const maxRaiseTotal = currentActive.chips + currentActive.currentBet;
      const actualRaiseTo = Math.min(amount, maxRaiseTotal);
      const toAdd = actualRaiseTo - currentActive.currentBet;
      isAllIn = toAdd >= currentActive.chips;
      potAdd = Math.max(0, toAdd);
      actualBetTo = actualRaiseTo;
      logMessage = isAllIn ? `${playerName} raises ALL-IN to $${actualRaiseTo}` : `${playerName} raises to $${actualRaiseTo}`;
    }

    const optimalAction = getOptimalAction(
      handStrength,
      currentActive.positionName,
      gameState.street,
      potOdds,
      facingBet,
      gameState.currentBet
    );

    if (potAdd > 0) {
      setGameState(g => ({
        ...g,
        pot: g.pot + potAdd,
        currentBet: action === 'raise' ? actualBetTo : g.currentBet,
        minRaise: action === 'raise' ? actualBetTo + bigBlind : g.minRaise
      }));
    }

    setPlayers(prev => {
      const newPlayers = prev.map(p => ({ ...p }));
      const playerIdx = newPlayers.findIndex(p => p.isActive);
      if (playerIdx === -1) return prev;

      const player = newPlayers[playerIdx];

      if (action === 'fold') {
        player.isFolded = true;
      } else if (action === 'call') {
        const neededToCall = gameState.currentBet - player.currentBet;
        const callAmt = Math.min(neededToCall, player.chips);
        player.chips -= callAmt;
        player.currentBet += callAmt;
      } else if (action === 'raise') {
        const maxRaiseTotal = player.chips + player.currentBet;
        const actualRaiseTo = Math.min(amount, maxRaiseTotal);
        const toAdd = actualRaiseTo - player.currentBet;
        player.chips -= Math.max(0, toAdd);
        player.currentBet = actualRaiseTo;
        // Reset hasActed for others only if this is an actual raise (not just calling all-in)
        // But DON'T reset for all-in players (they can't act anyway)
        if (actualRaiseTo > gameState.currentBet) {
          newPlayers.forEach((p, i) => {
            if (i !== playerIdx && !p.isFolded && p.chips > 0) {
              p.hasActed = false;
            }
          });
        }
      }

      player.hasActed = true;
      player.isActive = false;

      const activePlayers = newPlayers.filter(p => !p.isFolded);
      if (activePlayers.length > 1) {
        // Find next non-folded, non-all-in player
        let nextPos = (playerIdx + 1) % newPlayers.length;
        let attempts = 0;
        while ((newPlayers[nextPos].isFolded || newPlayers[nextPos].chips === 0) && attempts < 7) {
          nextPos = (nextPos + 1) % newPlayers.length;
          attempts++;
        }

        // Determine if round is complete - use the actual new bet amount
        const newCurrentBet = action === 'raise' ? player.currentBet : gameState.currentBet;
        const roundComplete = activePlayers.every(p => {
          if (p.id === player.id) return true; // Just acted
          if (p.chips === 0) return true; // All-in players are done
          return p.hasActed && p.currentBet === newCurrentBet;
        });

        // Only mark next player active if round not complete AND they can act
        if (!roundComplete && attempts < 7 && newPlayers[nextPos].chips > 0) {
          newPlayers[nextPos].isActive = true;
        }
      }

      return newPlayers;
    });

    setActionLog(prev => [...prev, {
      message: logMessage,
      playerPosition: currentActive.positionName,
      action,
      amount: potAdd || undefined,
      optimalAction,
      handStrength
    }]);

    // Track stats for the human player (position 0)
    if (currentActive.position === 0) {
      updatePlayerStats(currentActive.id, action, potAdd || 0, gameState.street, gameState.pot);
    }
  }, [players, gameState, bigBlind, updatePlayerStats]);

  // Ref to prevent AI action clustering
  const aiProcessingRef = useRef(false);
  const lastAiPlayerRef = useRef<string | null>(null);

  // Auto-skip user's turn if they're all-in
  useEffect(() => {
    if (!gameStarted) return;
    const currentActive = players.find(p => p.isActive);
    if (!currentActive || currentActive.position !== 0) return; // Only handle user
    if (currentActive.chips > 0) return; // User has chips, let them act normally

    // User is all-in but marked active - auto-skip their turn
    setPlayers(prev => {
      const newPlayers = prev.map(p => ({ ...p }));
      const userIdx = newPlayers.findIndex(p => p.position === 0);
      if (userIdx === -1 || !newPlayers[userIdx].isActive) return prev;

      newPlayers[userIdx].hasActed = true;
      newPlayers[userIdx].isActive = false;

      // Find next non-folded, non-all-in player
      let nextPos = (userIdx + 1) % newPlayers.length;
      let attempts = 0;
      while ((newPlayers[nextPos].isFolded || newPlayers[nextPos].chips === 0) && attempts < 7) {
        newPlayers[nextPos].hasActed = true;
        nextPos = (nextPos + 1) % newPlayers.length;
        attempts++;
      }
      if (attempts < 7 && newPlayers[nextPos].chips > 0 && !newPlayers[nextPos].isFolded) {
        newPlayers[nextPos].isActive = true;
      }
      return newPlayers;
    });
  }, [gameStarted, players]);

  // ELITE AI Logic - GTO Crusher
  useEffect(() => {
    if (!gameStarted) return;
    const currentActive = players.find(p => p.isActive);
    if (!currentActive || currentActive.position === 0) return;

    // Prevent duplicate processing for same player
    if (aiProcessingRef.current && lastAiPlayerRef.current === currentActive.id) {
      return;
    }

    aiProcessingRef.current = true;
    lastAiPlayerRef.current = currentActive.id;

    const timer = setTimeout(() => {
      // Double-check player is still active
      const stillActive = players.find(p => p.isActive);
      if (!stillActive || stillActive.id !== currentActive.id) {
        aiProcessingRef.current = false;
        return;
      }

      // If AI is all-in, auto-check or skip
      if (currentActive.chips <= 0) {
        if (gameState.currentBet <= currentActive.currentBet) {
          processAction('check');
        } else {
          setPlayers(prev => {
            const newPlayers = prev.map(p => ({ ...p }));
            const idx = newPlayers.findIndex(p => p.isActive);
            if (idx !== -1) {
              newPlayers[idx].hasActed = true;
              newPlayers[idx].isActive = false;
              let nextPos = (idx + 1) % newPlayers.length;
              let attempts = 0;
              while ((newPlayers[nextPos].isFolded || newPlayers[nextPos].chips === 0) && attempts < 8) {
                newPlayers[nextPos].hasActed = true;
                nextPos = (nextPos + 1) % newPlayers.length;
                attempts++;
              }
              if (attempts < 8 && !newPlayers[nextPos].hasActed) {
                newPlayers[nextPos].isActive = true;
              }
            }
            return newPlayers;
          });
        }
        return;
      }

      // === ELITE AI DECISION ENGINE ===
      
      const cards = currentActive.cards.map(c => ({ ...c, hidden: false }));
      const handStrength = evaluateBoardStrength(cards, gameState.communityCards);
      const callAmount = gameState.currentBet - currentActive.currentBet;
      const pot = gameState.pot;
      const potOdds = pot > 0 ? (callAmount / (pot + callAmount)) * 100 : 0;
      
      // Board texture analysis
      const boardTexture = analyzeBoardTexture(gameState.communityCards);
      
      // Draw equity calculation
      const drawEquity = calculateDrawEquity(cards, gameState.communityCards);
      
      // Stack-to-pot ratio
      const spr = pot > 0 ? currentActive.chips / pot : 10;
      
      // Get opponent stats (the human player)
      const humanStats = playerStats['1'] || createEmptyStats();
      
      // Active players count (affects range decisions)
      const activePlayers = players.filter(p => !p.isFolded).length;
      
      // Position-based factors
      const position = currentActive.positionName;
      const gtoRange = GTO_RANGES[position];
      const streetAggression = STREET_AGGRESSION[gameState.street];
      
      // === EXPLOITATIVE ADJUSTMENTS ===
      
      // Is human playing too loose? (VPIP > 35%)
      const humanIsLoose = humanStats.oddsPlayedPreflop > 35;
      // Is human playing too passive? (AF < 1.5)
      const humanIsPassive = humanStats.aggression < 1.5;
      // Does human fold too much to c-bets?
      const humanFoldsToCBet = humanStats.cBetFaced > 3 && (humanStats.foldToCBet / humanStats.cBetFaced) > 0.6;
      // Is human aggressive? (AF > 2.5)
      const humanIsAggressive = humanStats.aggression > 2.5;
      
      // === CALCULATE EFFECTIVE STRENGTH ===
      
      let effectiveStrength = handStrength;
      
      // GTO range adjustment - tighten/loosen based on position
      const rangeWidth = gtoRange.open;
      if (handStrength < rangeWidth) {
        effectiveStrength -= 5; // Below our opening range, penalize
      }
      
      // Exploit loose players - value bet thinner
      if (humanIsLoose) {
        effectiveStrength += 5; // Our medium hands play better vs wide ranges
      }
      
      // Add draw equity on flop/turn
      if (gameState.street === 'flop' || gameState.street === 'turn') {
        effectiveStrength += drawEquity.equity * 0.7;
      }
      
      // Board texture adjustments
      if (boardTexture.wetness > 60) {
        // Wet board - need stronger hands, draws have more value
        effectiveStrength -= 5;
        if (drawEquity.totalOuts >= 8) effectiveStrength += 10;
      } else if (boardTexture.wetness < 30) {
        // Dry board - bluffs work better, medium hands hold up
        effectiveStrength += 3;
      }
      
      // Multi-way adjustment (tighten up)
      if (activePlayers > 2) {
        effectiveStrength -= (activePlayers - 2) * 5;
      }
      
      // SPR adjustment
      if (spr < 3) {
        // Short SPR - commit with strong hands, fold medium
        if (effectiveStrength >= 70) effectiveStrength += 10;
        else if (effectiveStrength < 50) effectiveStrength -= 10;
      }
      
      // GTO mixing with variance
      const variance = (Math.random() - 0.5) * 10;
      const finalStrength = effectiveStrength + variance;
      
      // === BET SIZING LOGIC ===
      
      const maxBet = currentActive.chips + currentActive.currentBet;
      const canRaise = currentActive.chips > callAmount;
      
      // Polarized vs linear sizing
      const getPolarizedBetSize = (strength: number): number => {
        if (strength >= 85) {
          // Nuts - overbet for value
          return Math.min(pot * (1.2 + Math.random() * 0.8), maxBet);
        } else if (strength >= 70) {
          // Strong - standard value bet
          return Math.min(pot * (0.6 + Math.random() * 0.3), maxBet);
        } else if (strength < 40) {
          // Bluff - same size as value to be balanced
          return Math.min(pot * (0.6 + Math.random() * 0.3), maxBet);
        } else {
          // Medium - block bet or check
          return Math.min(pot * (0.25 + Math.random() * 0.15), maxBet);
        }
      };
      
      // === DECISION MAKING ===
      
      if (callAmount === 0) {
        // === BETTING SPOT (checked to us or we're first) ===
        
        const shouldValueBet = finalStrength >= 65;
        const shouldSemiBluff = drawEquity.totalOuts >= 6 && finalStrength >= 35;
        const shouldBluff = finalStrength < 30 && Math.random() < 0.25 * streetAggression;
        
        // Exploit: Bet more vs passive/foldy opponents
        const exploitBetFreq = humanIsPassive || humanFoldsToCBet ? 0.15 : 0;
        
        if (shouldValueBet && canRaise) {
          const betSize = getPolarizedBetSize(finalStrength);
          processAction('raise', Math.max(gameState.minRaise, Math.floor(betSize)));
        } else if (shouldSemiBluff && canRaise && Math.random() < 0.7) {
          const betSize = pot * (0.5 + Math.random() * 0.25);
          processAction('raise', Math.min(Math.max(gameState.minRaise, Math.floor(betSize)), maxBet));
        } else if ((shouldBluff || Math.random() < exploitBetFreq) && canRaise) {
          const bluffSize = pot * (0.6 + Math.random() * 0.3);
          processAction('raise', Math.min(Math.max(gameState.minRaise, Math.floor(bluffSize)), maxBet));
        } else {
          // Check with intention - might check-raise
          processAction('check');
        }
        
      } else {
        // === FACING A BET ===
        
        const requiredEquity = potOdds;
        const impliedEquity = drawEquity.impliedOdds;
        
        // === VALUE RAISE ===
        if (finalStrength >= 85 && canRaise) {
          // Monster - raise big
          const raiseSize = gameState.currentBet * (2.5 + Math.random() * 1.5);
          processAction('raise', Math.min(Math.floor(raiseSize), maxBet));
        }
        // === STRONG CALL/RAISE ===
        else if (finalStrength >= 70 && canRaise) {
          // Strong hand - mix between raise and call
          if (Math.random() < 0.4) {
            const raiseSize = gameState.currentBet * (2 + Math.random());
            processAction('raise', Math.min(Math.floor(raiseSize), maxBet));
          } else {
            processAction('call');
          }
        }
        // === CALLING RANGE ===
        else if (finalStrength >= requiredEquity + 10) {
          processAction('call');
        }
        // === DRAW WITH ODDS ===
        else if (drawEquity.totalOuts >= 8 && impliedEquity >= requiredEquity) {
          // Good draw with implied odds - call or semi-bluff raise
          if (Math.random() < 0.3 && canRaise) {
            processAction('raise', Math.min(gameState.currentBet * 2.5, maxBet));
          } else {
            processAction('call');
          }
        }
        // === MARGINAL SPOTS ===
        else if (finalStrength >= requiredEquity - 5 && Math.random() < 0.5) {
          // Close decision - sometimes call to not be exploitable
          processAction('call');
        }
        // === BLUFF CATCH ===
        else if (humanIsAggressive && finalStrength >= 40 && Math.random() < 0.35) {
          // Exploit: Call down aggressive players lighter
          processAction('call');
        }
        // === BLUFF RAISE ===
        else if (finalStrength < 25 && canRaise && Math.random() < 0.12 * streetAggression) {
          // Balanced bluff raise (polarized)
          processAction('raise', Math.min(gameState.currentBet * 3, maxBet));
        }
        // === FOLD ===
        else {
          processAction('fold');
        }
      }
      
      aiProcessingRef.current = false;
    }, 600 + Math.random() * 500);

    return () => {
      clearTimeout(timer);
      aiProcessingRef.current = false;
    };
  }, [players, gameState, gameStarted, processAction, playerStats]);

  // Check for street advancement
  useEffect(() => {
    if (!gameStarted || replayMode) return; // Don't process if already in replay mode
    const activePlayers = players.filter(p => !p.isFolded);

    if (activePlayers.length <= 1) {
      // Hand is over - winner by fold
      if (activePlayers.length === 1 && gameState.pot > 0) {
        const winner = activePlayers[0];
        const potWon = gameState.pot;
        const winnerName = winner.name === 'You' ? 'You' : `${winner.positionName} (AI)`;

        // Award pot to winner
        setPlayers(prev => prev.map(p =>
          p.id === winner.id
            ? { ...p, chips: p.chips + potWon }
            : p
        ));

        setActionLog(prev => [...prev, {
          message: `${winnerName} wins $${potWon}!`,
          playerPosition: winner.positionName,
          action: 'check'
        }]);

        // Set hand winner and reset pot
        setHandWinner(`${winnerName} wins $${potWon}!`);
        setGameState(prev => ({ ...prev, pot: 0 }));
        setReplayMode(true);
      }
      return;
    }

    // Handle showdown - compare hands
    if (gameState.street === 'showdown' && gameState.pot > 0) {
      // Evaluate each player's hand strength
      const playerStrengths = activePlayers.map(p => ({
        player: p,
        strength: evaluateBoardStrength(
          p.cards.map(c => ({ ...c, hidden: false })),
          gameState.communityCards
        )
      }));

      // Find winner (highest strength)
      const winner = playerStrengths.reduce((best, curr) =>
        curr.strength > best.strength ? curr : best
      );

      const potWon = gameState.pot;
      const winnerName = winner.player.name === 'You' ? 'You' : `${winner.player.positionName} (AI)`;

      // Award pot to winner
      setPlayers(prev => prev.map(p =>
        p.id === winner.player.id
          ? { ...p, chips: p.chips + potWon }
          : p
      ));

      setActionLog(prev => [...prev, {
        message: `${winnerName} wins $${potWon} at showdown!`,
        playerPosition: winner.player.positionName,
        action: 'check'
      }]);

      // Set hand winner
      setHandWinner(`${winnerName} wins $${potWon} at showdown!`);

      // Reset pot and enter replay mode
      setGameState(prev => ({ ...prev, pot: 0 }));
      setReplayMode(true);
      return;
    }

    // Round is complete when all active players have acted AND either:
    // - matched the current bet, OR
    // - are all-in (chips === 0)
    const roundComplete = activePlayers.every(p =>
      p.hasActed && (p.currentBet === gameState.currentBet || p.chips === 0)
    );
    const noOneActive = !players.some(p => p.isActive);

    if (roundComplete && noOneActive) {
      setTimeout(() => advanceStreet(), 400);
    }

    // Failsafe: If no one is active but game should continue, find next player
    if (noOneActive && !roundComplete && gameState.street !== 'showdown') {
      const playersWhoCanAct = activePlayers.filter(p => p.chips > 0 && !p.hasActed);
      if (playersWhoCanAct.length > 0) {
        // Find dealer to determine action order
        const dealerIdx = players.findIndex(p => p.isDealer);
        let nextPos = (dealerIdx + 1) % players.length;
        let attempts = 0;
        while (attempts < 7) {
          const player = players[nextPos];
          if (!player.isFolded && player.chips > 0 && !player.hasActed) {
            setPlayers(prev => prev.map((p, i) => ({
              ...p,
              isActive: i === nextPos
            })));
            break;
          }
          nextPos = (nextPos + 1) % players.length;
          attempts++;
        }
      }
    }
  }, [players, gameState, gameStarted, replayMode, advanceStreet]);

  const handleFold = () => {
    if (!userPlayer || userPlayer.chips <= 0) return; // Can't act if all-in
    processAction('fold');
  };
  const handleCheck = () => {
    if (!userPlayer || userPlayer.chips <= 0) return; // Can't act if all-in
    processAction('check');
  };
  const handleCall = () => {
    if (!userPlayer || userPlayer.chips <= 0) return; // Can't act if all-in
    processAction('call');
  };
  const handleRaise = (amount: number) => {
    if (!userPlayer || userPlayer.chips <= 0) return; // Can't act if all-in
    processAction('raise', amount);
  };

  const getPositionStyle = (posIndex: number): React.CSSProperties => {
    // Positions arranged in oval around table (clockwise from bottom)
    // 8 players evenly spread around the oval
    const positions = [
      { bottom: '-5%', left: '50%', transform: 'translateX(-50%)' },  // Seat 0 - bottom center (User)
      { bottom: '5%', left: '12%' },                                   // Seat 1 - lower left
      { top: '40%', left: '-3%', transform: 'translateY(-50%)' },      // Seat 2 - middle left
      { top: '5%', left: '12%' },                                      // Seat 3 - upper left
      { top: '-5%', left: '50%', transform: 'translateX(-50%)' },      // Seat 4 - top center
      { top: '5%', right: '12%' },                                     // Seat 5 - upper right
      { top: '40%', right: '-3%', transform: 'translateY(-50%)' },     // Seat 6 - middle right
      { bottom: '5%', right: '12%' },                                  // Seat 7 - lower right
    ];
    return positions[posIndex] || {};
  };;;;

  const callAmount = userPlayer ? gameState.currentBet - userPlayer.currentBet : 0;
  const canCheck = callAmount === 0;

  // Show interactive tutorial if active
  if (interactiveTutorial) {
    return <InteractiveTutorial onExit={() => setInteractiveTutorial(false)} />;
  }

  // Show tutorial if in tutorial mode
  if (tutorialMode) {
    return <Tutorial onExit={() => setTutorialMode(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 pb-36 overflow-hidden">
      {/* Start Screen */}
      {!gameStarted && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-emerald-900/30 flex items-center justify-center z-50">
          <div className="bg-gray-800/90 backdrop-blur-sm p-10 rounded-2xl border border-emerald-700/50 text-center shadow-2xl shadow-emerald-900/20 max-w-md">
            <div className="mb-6">
              <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">Texas Hold'em</h1>
              <h2 className="text-2xl font-semibold text-emerald-400">Trainer</h2>
            </div>
            <p className="text-gray-400 mb-8">Learn to play like a pro with GTO-based AI opponents</p>
            <div className="flex flex-col gap-4">
              <button
                onClick={() => startNewGame(false)}
                className="px-8 py-4 bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white font-bold rounded-xl text-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#065f46,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#065f46,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#065f46]"
              >
                Practice Mode
              </button>
              <p className="text-gray-500 text-xs -mt-2">Play individual hands with fresh chips each time</p>
              <button
                onClick={() => startNewGame(true)}
                className="px-8 py-4 bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 text-white font-bold rounded-xl text-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#1e40af,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#1e40af,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#1e40af]"
              >
                Full Game
              </button>
              <p className="text-gray-500 text-xs -mt-2">Play until one player has all the chips</p>
              <div className="border-t border-gray-600/50 my-4"></div>
              <button
                onClick={() => setTutorialMode(true)}
                className="px-8 py-4 bg-gradient-to-b from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-gray-900 font-bold rounded-xl text-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#b45309,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#b45309,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#b45309]"
              >
                Tutorial
              </button>
              <p className="text-gray-500 text-xs -mt-2">Learn Texas Hold'em from scratch</p>
              <button
                onClick={() => setInteractiveTutorial(true)}
                className="px-8 py-4 bg-gradient-to-b from-purple-500 to-purple-700 hover:from-purple-400 hover:to-purple-600 text-white font-bold rounded-xl text-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#581c87,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#581c87,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#581c87]"
              >
                Interactive Tutorial
              </button>
              <p className="text-gray-500 text-xs -mt-2">Learn by playing guided hands</p>
            </div>
          </div>
        </div>
      )}

      {/* Game Winner Overlay */}
      {gameWinner && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-amber-900/30 flex items-center justify-center z-50">
          <div className="bg-gray-800/90 backdrop-blur-sm p-10 rounded-2xl border border-amber-500/50 text-center shadow-2xl shadow-amber-900/30">
            <div className="flex items-center justify-center gap-3 mb-4">
              <PokerIcon name="winner" size={48} />
              <h1 className="text-4xl font-bold text-amber-400">Game Over!</h1>
            </div>
            <p className="text-2xl text-white mb-8">{gameWinner}</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => startNewGame(true)}
                className="px-6 py-3 bg-gradient-to-b from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 text-white font-bold rounded-xl transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#1e40af,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#1e40af,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#1e40af]"
              >
                New Game
              </button>
              <button
                onClick={() => startNewGame(false)}
                className="px-6 py-3 bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white font-bold rounded-xl transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_4px_0_0_#065f46,0_6px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_2px_0_0_#065f46,0_4px_8px_rgba(0,0,0,0.3)] active:translate-y-0.5 active:shadow-[0_1px_0_0_#065f46]"
              >
                Practice Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hand Winner Display */}
      {handWinner && !gameWinner && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <div className="bg-black/80 px-8 py-4 rounded-xl border-2 border-yellow-500">
            <p className="text-2xl font-bold text-yellow-400 text-center">{handWinner}</p>
            {fullGameMode && (
              <p className="text-sm text-gray-300 text-center mt-2">
                {isPaused ? '⏸ Paused - Resume to continue' : '⏳ Next hand starting...'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action Log */}
      {gameStarted && (
        <ActionLog
          actions={actionLog}
          expanded={logsExpanded}
          onToggle={() => setLogsExpanded(!logsExpanded)}
          positionTip={currentPositionTip}
          optimalPlay={currentOptimalPlay}
        />
      )}

      {/* Replay Controls */}
      {gameStarted && !gameWinner && (
        <div className="absolute left-4 top-4 bg-gray-800 p-3 rounded-lg border border-gray-700">
          <div className="flex flex-col gap-2">
            {fullGameMode && (
              <div className="mb-2">
                <div className="text-yellow-400 text-xs font-bold">
                  Hand #{handNumber} - Full Game
                </div>
                <div className="text-cyan-400 text-xs mt-1">
                  Blinds: ${smallBlind}/${bigBlind} (Level {blindLevel + 1})
                </div>
                <div className="text-gray-400 text-[10px]">
                  Next level in {handsPerLevel - ((handNumber - 1) % handsPerLevel)} hands
                </div>
              </div>
            )}
            {fullGameMode ? (
              <>
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className={`px-4 py-2 ${isPaused ? 'bg-gradient-to-b from-emerald-500 to-emerald-700 shadow-[0_2px_0_0_#065f46,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#065f46]' : 'bg-gradient-to-b from-amber-500 to-amber-700 shadow-[0_2px_0_0_#92400e,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#92400e]'} text-white text-sm font-bold rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0`}
                >
                  {isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button
                  onClick={() => { setIsPaused(false); startNewGame(true); }}
                  className="px-4 py-2 bg-gradient-to-b from-red-500 to-red-700 hover:from-red-400 hover:to-red-600 text-white text-sm font-bold rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#991b1b,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#991b1b] active:translate-y-0 active:shadow-[0_0px_0_0_#991b1b]"
                >
                  Restart Game
                </button>
              </>
            ) : (
              <button
                onClick={() => startNewGame(false)}
                className="px-4 py-2 bg-gradient-to-b from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white text-sm font-bold rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#065f46,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#065f46] active:translate-y-0 active:shadow-[0_0px_0_0_#065f46]"
              >
                New Hand
              </button>
            )}
            {replayMode && (
              <label className="flex items-center gap-2 text-white text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAllHands}
                  onChange={(e) => setShowAllHands(e.target.checked)}
                  className="w-4 h-4 accent-green-500"
                />
                Show All Hands
              </label>
            )}
            <button
                onClick={() => { setIsPaused(false); setGameStarted(false); setGameWinner(null); }}
                className="px-4 py-2 bg-gradient-to-b from-gray-500 to-gray-700 hover:from-gray-400 hover:to-gray-600 text-white text-xs rounded-lg transition-all duration-200 transform hover:-translate-y-0.5 shadow-[0_2px_0_0_#374151,0_3px_6px_rgba(0,0,0,0.3)] hover:shadow-[0_1px_0_0_#374151] active:translate-y-0 active:shadow-[0_0px_0_0_#374151]"
              >
                Exit
              </button>
          </div>
        </div>
      )}

      {/* Table Container */}
      <div className="relative w-full max-w-4xl aspect-[2/1] bg-green-800 rounded-[180px] border-[14px] border-green-900 shadow-2xl flex items-center justify-center">
        <div className="absolute inset-0 rounded-[166px] border border-green-700 opacity-50 pointer-events-none"></div>

        {/* Center Area - lower z-index so player cards appear above */}
        <div className="flex flex-col items-center gap-3 z-0">
          {/* Street Indicator */}
          <div className="text-yellow-500 text-lg font-bold uppercase tracking-wider">
            {gameState.street}
          </div>

          {/* Community Cards */}
          <div className="flex gap-2">
            {gameState.communityCards.map((card, idx) => (
              <PlayingCard key={idx} card={card} />
            ))}
            {[...Array(5 - gameState.communityCards.length)].map((_, i) => (
              <div key={i} className="w-10 h-14 sm:w-12 sm:h-16 border-2 border-green-600/50 rounded-lg bg-green-900/20" />
            ))}
          </div>
        </div>

        {/* Render Players */}
        {players.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            style={getPositionStyle(player.position)}
            showHiddenCards={showAllHands || (replayMode && gameState.street === 'showdown')}
          />
        ))}
      </div>

      {/* Pot Odds Info */}
      {gameStarted && isUserTurn && !replayMode && (
        <PotOddsInfo
          pot={gameState.pot}
          callAmount={callAmount}
          street={gameState.street}
          isUserTurn={isUserTurn}
        />
      )}

      {/* Action Bar */}
      {gameStarted && (
        <ActionControls
          onFold={handleFold}
          onCheck={handleCheck}
          onCall={handleCall}
          onRaise={handleRaise}
          callAmount={callAmount}
          minRaise={gameState.minRaise}
          maxRaise={userPlayer?.chips ?? 0}
          canCheck={canCheck}
          disabled={!isUserTurn || replayMode || !userPlayer || userPlayer.chips <= 0}
          smallBlind={smallBlind}
          bigBlind={bigBlind}
          pot={gameState.pot}
        />
      )}
    </div>
  );
};

function App() {
  return <PokerTable />;
}

export default App;
