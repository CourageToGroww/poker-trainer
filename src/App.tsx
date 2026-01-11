import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

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
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 p-3 z-50">
      <div className="max-w-4xl mx-auto flex flex-col gap-3">
        {/* Raise presets */}
        <div className="flex justify-center gap-2 flex-wrap">
          {presetRaises.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setRaiseAmount(Math.min(Math.max(preset.amount, minRaise), maxRaise))}
              disabled={disabled}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white rounded transition-colors"
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
          <div className="flex gap-2">
            <button
              onClick={onFold}
              disabled={disabled}
              className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold shadow-lg transition-colors"
            >
              Fold
            </button>

            {canCheck ? (
              <button
                onClick={onCheck}
                disabled={disabled}
                className="px-5 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold shadow-lg transition-colors"
              >
                Check
              </button>
            ) : (
              <button
                onClick={onCall}
                disabled={disabled}
                className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold shadow-lg transition-colors"
              >
                Call ${callAmount}
              </button>
            )}

            <button
              onClick={() => onRaise(raiseAmount)}
              disabled={disabled}
              className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold shadow-lg transition-colors min-w-[100px]"
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
            🎯 OPTIMAL PLAY NOW ({optimalPlay.position})
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
          <div className="text-yellow-400 text-xs font-bold mb-1">📍 Position Strategy ({optimalPlay?.position || 'General'}):</div>
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
  // Blind structure - increases every 5 hands in tournament mode
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
    setBlindLevel(0); // Reset blinds for new tournament
  };

  const startNextHand = useCallback(() => {
    // Get current chip counts
    const chipCounts = players.map(p => p.chips + p.currentBet);

    // Check for game winner (only one player with chips)
    const playersWithChips = chipCounts.filter(c => c > 0);
    if (playersWithChips.length <= 1) {
      const winnerIdx = chipCounts.findIndex(c => c > 0);
      const winner = players[winnerIdx];
      setGameWinner(winner?.name === 'You' ? 'You win the tournament!' : `${winner?.positionName} (AI) wins the tournament!`);
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

  // Auto-continue to next hand in tournament mode
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
  }, [players, gameState, bigBlind]);

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

  // HARD AI Logic - GTO-inspired
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
          // All-in and can't match - mark as acted and move on
          setPlayers(prev => {
            const newPlayers = prev.map(p => ({ ...p }));
            const idx = newPlayers.findIndex(p => p.isActive);
            if (idx !== -1) {
              newPlayers[idx].hasActed = true;
              newPlayers[idx].isActive = false;
              // Find next active player
              let nextPos = (idx + 1) % newPlayers.length;
              let attempts = 0;
              while ((newPlayers[nextPos].isFolded || newPlayers[nextPos].chips === 0) && attempts < 7) {
                newPlayers[nextPos].hasActed = true; // Mark all-in players as acted
                nextPos = (nextPos + 1) % newPlayers.length;
                attempts++;
              }
              if (attempts < 7 && !newPlayers[nextPos].hasActed) {
                newPlayers[nextPos].isActive = true;
              }
            }
            return newPlayers;
          });
        }
        return;
      }

      const cards = currentActive.cards.map(c => ({ ...c, hidden: false }));
      const handStrength = evaluateBoardStrength(cards, gameState.communityCards);
      const callAmount = gameState.currentBet - currentActive.currentBet;
      const potOdds = gameState.pot > 0 ? (callAmount / (gameState.pot + callAmount)) * 100 : 0;

      // Position-based aggression factor
      const positionFactor: Record<Position, number> = {
        'BTN': 1.3, 'CO': 1.2, 'HJ': 1.1, 'MP': 1.0, 'UTG+1': 0.9, 'UTG': 0.85, 'SB': 0.9, 'BB': 1.0
      };
      const aggression = positionFactor[currentActive.positionName] || 1;

      // Adjusted hand strength with position
      const effectiveStrength = handStrength * aggression;

      // Add randomness for unpredictability (GTO mixing)
      const variance = (Math.random() - 0.5) * 15;
      const finalStrength = effectiveStrength + variance;

      // Calculate max raise this AI can make
      const maxAIRaise = currentActive.chips + currentActive.currentBet;
      const canRaise = currentActive.chips > callAmount; // Has chips beyond calling

      if (callAmount === 0) {
        // Can check - decide to check or bet
        if (finalStrength >= 70 && canRaise) {
          // Value bet - cap to available chips
          const betSize = Math.floor(gameState.pot * (0.5 + Math.random() * 0.5));
          const actualBet = Math.min(Math.max(gameState.minRaise, betSize), maxAIRaise);
          processAction('raise', actualBet);
        } else if (finalStrength >= 40 && Math.random() < 0.3 * aggression && canRaise) {
          // Semi-bluff - cap to available chips
          processAction('raise', Math.min(gameState.minRaise, maxAIRaise));
        } else {
          processAction('check');
        }
      } else {
        // Facing a bet
        const requiredEquity = potOdds;

        if (finalStrength >= 80 && canRaise) {
          // Strong hand - raise for value (capped to chips)
          const raiseSize = Math.floor(gameState.currentBet * (2 + Math.random()));
          processAction('raise', Math.min(raiseSize, maxAIRaise));
        } else if (finalStrength >= requiredEquity + 15) {
          // Good hand - call
          processAction('call');
        } else if (finalStrength >= requiredEquity && Math.random() < 0.6) {
          // Marginal - sometimes call
          processAction('call');
        } else if (finalStrength >= 50 && Math.random() < 0.15 * aggression && canRaise) {
          // Bluff raise occasionally (capped to chips)
          processAction('raise', Math.min(gameState.currentBet * 2.5, maxAIRaise));
        } else {
          // Fold
          processAction('fold');
        }
      }
      // Reset processing flag after action
      aiProcessingRef.current = false;
    }, 800 + Math.random() * 400);

    return () => {
      clearTimeout(timer);
      aiProcessingRef.current = false;
    };
  }, [players, gameState, gameStarted, processAction]);

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

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 pb-36 overflow-hidden">
      {/* Start Screen */}
      {!gameStarted && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-8 rounded-xl border border-gray-600 text-center">
            <h1 className="text-3xl font-bold text-white mb-4">Texas Hold'em Trainer</h1>
            <p className="text-gray-400 mb-6">Learn to play like a pro with GTO-based AI opponents</p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => startNewGame(false)}
                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg text-lg transition-colors"
              >
                Practice Mode
              </button>
              <p className="text-gray-500 text-xs">Play individual hands with fresh chips each time</p>
              <button
                onClick={() => startNewGame(true)}
                className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-lg transition-colors"
              >
                Full Tournament
              </button>
              <p className="text-gray-500 text-xs">Play until one player has all the chips</p>
            </div>
          </div>
        </div>
      )}

      {/* Game Winner Overlay */}
      {gameWinner && (
        <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-8 rounded-xl border border-yellow-500 text-center">
            <h1 className="text-4xl font-bold text-yellow-400 mb-4">🏆 Tournament Over!</h1>
            <p className="text-2xl text-white mb-6">{gameWinner}</p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => startNewGame(true)}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-colors"
              >
                New Tournament
              </button>
              <button
                onClick={() => startNewGame(false)}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg transition-colors"
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
                  Hand #{handNumber} - Tournament Mode
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
                  className={`px-4 py-2 ${isPaused ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'} text-white text-sm font-bold rounded transition-colors`}
                >
                  {isPaused ? '▶ Resume' : '⏸ Pause'}
                </button>
                <button
                  onClick={() => { setIsPaused(false); startNewGame(true); }}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded transition-colors"
                >
                  Restart Tournament
                </button>
              </>
            ) : (
              <button
                onClick={() => startNewGame(false)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded transition-colors"
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
            {fullGameMode && (
              <button
                onClick={() => { setIsPaused(false); startNewGame(false); }}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded transition-colors"
              >
                Exit Tournament
              </button>
            )}
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
