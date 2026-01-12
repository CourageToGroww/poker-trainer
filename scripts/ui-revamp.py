#!/usr/bin/env python3
"""
UI Revamp Script using Gemini 3 Pro and Nano Banana Pro
- Gemini 3 Pro: Analyzes UI and suggests improvements
- Nano Banana Pro: Generates icons to replace emojis
"""

import os
import sys
import json
import base64
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Installing google-genai package...")
    os.system("pip install google-genai python-dotenv pillow")
    from google import genai
    from google.genai import types

from PIL import Image

# Initialize client
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    print("Error: GEMINI_API_KEY not found in .env file")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)

# Icons to generate (emoji -> description for icon generation)
ICONS_TO_GENERATE = {
    "practice": {
        "emoji": "🎯",
        "prompt": "A minimal, modern gaming icon representing practice mode. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple target or crosshair design.",
        "filename": "practice-icon.png"
    },
    "fullgame": {
        "emoji": "🏆",
        "prompt": "A minimal, modern gaming icon representing a full game or tournament. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple trophy or championship cup design.",
        "filename": "fullgame-icon.png"
    },
    "tutorial": {
        "emoji": "📚",
        "prompt": "A minimal, modern icon representing a tutorial or learning. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple book or education symbol.",
        "filename": "tutorial-icon.png"
    },
    "interactive": {
        "emoji": "🎮",
        "prompt": "A minimal, modern gaming icon representing interactive gameplay. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple game controller or play symbol.",
        "filename": "interactive-icon.png"
    },
    "cards": {
        "emoji": "🃏",
        "prompt": "A minimal, modern icon representing playing cards. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple card or deck symbol.",
        "filename": "cards-icon.png"
    },
    "chips": {
        "emoji": "💰",
        "prompt": "A minimal, modern icon representing poker chips or money. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple chip stack or coin symbol.",
        "filename": "chips-icon.png"
    },
    "winner": {
        "emoji": "👑",
        "prompt": "A minimal, modern icon representing a winner or champion. Single color gold/yellow icon on transparent background, clean vector style, suitable for dark UI. Simple crown design.",
        "filename": "winner-icon.png"
    },
    "fold": {
        "emoji": "🚫",
        "prompt": "A minimal, modern icon representing fold action in poker. Single color red icon on transparent background, clean vector style, suitable for dark UI. Simple X or stop symbol.",
        "filename": "fold-icon.png"
    },
    "check": {
        "emoji": "✓",
        "prompt": "A minimal, modern icon representing check action in poker. Single color green icon on transparent background, clean vector style, suitable for dark UI. Simple checkmark.",
        "filename": "check-icon.png"
    },
    "raise": {
        "emoji": "⬆️",
        "prompt": "A minimal, modern icon representing raise action in poker. Single color blue icon on transparent background, clean vector style, suitable for dark UI. Simple upward arrow.",
        "filename": "raise-icon.png"
    },
    "allin": {
        "emoji": "🔥",
        "prompt": "A minimal, modern icon representing all-in action in poker. Single color orange/red icon on transparent background, clean vector style, suitable for dark UI. Simple flame or explosion symbol.",
        "filename": "allin-icon.png"
    },
    "position": {
        "emoji": "📍",
        "prompt": "A minimal, modern icon representing table position in poker. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple position marker or seat indicator.",
        "filename": "position-icon.png"
    }
}

def read_app_tsx():
    """Read the main App.tsx file"""
    app_path = Path(__file__).parent.parent / "src" / "App.tsx"
    with open(app_path, "r") as f:
        return f.read()

def get_ui_suggestions():
    """Use Gemini 3 Pro to analyze UI and suggest improvements"""
    print("\n" + "="*60)
    print("STEP 1: Analyzing UI with Gemini 3 Pro")
    print("="*60 + "\n")

    app_code = read_app_tsx()

    # Extract just the UI-related parts to reduce token usage
    # Focus on the return statements and component structure

    prompt = f"""You are a senior UI/UX designer and React developer. Analyze this Texas Hold'em Poker Trainer application and provide specific, actionable UI improvements.

The app uses React, TypeScript, and Tailwind CSS. It has:
- A main menu with Practice Mode, Full Game, Tutorial, and Interactive Tutorial buttons
- A poker table with 8 players arranged in an oval
- Card displays, chip counts, action buttons
- Tutorial components

Please provide:
1. **Color Scheme Improvements**: Suggest a more professional poker-themed color palette
2. **Layout Improvements**: Better spacing, alignment, and visual hierarchy
3. **Component Styling**: Specific Tailwind classes to improve buttons, cards, player positions
4. **Animation Suggestions**: Subtle animations for better UX
5. **Typography**: Font improvements for readability
6. **Specific Code Changes**: Provide actual Tailwind class changes

Focus on making it look like a premium, professional poker application.

Here's a portion of the current UI code (main menu and key components):

```tsx
{app_code[:15000]}
```

Respond with a JSON object containing:
{{
  "colorScheme": {{
    "primary": "suggested color",
    "secondary": "suggested color",
    "accent": "suggested color",
    "background": "suggested color",
    "surface": "suggested color"
  }},
  "improvements": [
    {{
      "area": "component/section name",
      "current": "current classes or description",
      "suggested": "new classes or description",
      "reason": "why this improves UX"
    }}
  ],
  "animations": ["list of animation suggestions"],
  "typography": {{
    "headings": "suggested approach",
    "body": "suggested approach"
  }}
}}
"""

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=prompt,
        )

        print("UI Analysis Complete!")
        print("-" * 40)

        # Try to parse JSON from response
        text = response.text

        # Extract JSON if wrapped in markdown code blocks
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]

        try:
            suggestions = json.loads(text)
            print(json.dumps(suggestions, indent=2))
            return suggestions
        except json.JSONDecodeError:
            print("Raw suggestions:")
            print(response.text)
            return {"raw": response.text}

    except Exception as e:
        print(f"Error getting UI suggestions: {e}")
        return None

def generate_icon(name: str, config: dict, output_dir: Path):
    """Generate a single icon using Nano Banana Pro"""
    print(f"  Generating {name} icon...")

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=[config["prompt"]],
            config=types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"]
            )
        )

        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                # Save the image
                image_data = part.inline_data.data
                image_path = output_dir / config["filename"]

                # Decode and save
                with open(image_path, "wb") as f:
                    f.write(image_data)

                print(f"    Saved: {config['filename']}")
                return True

        print(f"    Warning: No image generated for {name}")
        return False

    except Exception as e:
        print(f"    Error generating {name}: {e}")
        return False

def generate_all_icons():
    """Generate all icons using Nano Banana Pro"""
    print("\n" + "="*60)
    print("STEP 2: Generating Icons with Nano Banana Pro")
    print("="*60 + "\n")

    # Create output directory
    output_dir = Path(__file__).parent.parent / "public" / "icons"
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Output directory: {output_dir}\n")

    successful = 0
    failed = 0

    for name, config in ICONS_TO_GENERATE.items():
        if generate_icon(name, config, output_dir):
            successful += 1
        else:
            failed += 1

    print(f"\nIcon Generation Complete!")
    print(f"  Successful: {successful}")
    print(f"  Failed: {failed}")

    return output_dir

def create_icon_component():
    """Create a React component for using the generated icons"""
    component_code = '''// Generated Icon Component
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
'''

    component_path = Path(__file__).parent.parent / "src" / "components" / "PokerIcon.tsx"
    component_path.parent.mkdir(parents=True, exist_ok=True)

    with open(component_path, "w") as f:
        f.write(component_code)

    print(f"\nCreated icon component: {component_path}")

def main():
    print("\n" + "="*60)
    print("  POKER TRAINER UI REVAMP")
    print("  Using Gemini 3 Pro & Nano Banana Pro")
    print("="*60)

    # Step 1: Get UI suggestions
    suggestions = get_ui_suggestions()

    if suggestions:
        # Save suggestions to file
        suggestions_path = Path(__file__).parent / "ui-suggestions.json"
        with open(suggestions_path, "w") as f:
            json.dump(suggestions, indent=2, fp=f)
        print(f"\nSaved suggestions to: {suggestions_path}")

    # Step 2: Generate icons
    icons_dir = generate_all_icons()

    # Step 3: Create icon component
    create_icon_component()

    print("\n" + "="*60)
    print("  UI REVAMP COMPLETE!")
    print("="*60)
    print(f"""
Next steps:
1. Review UI suggestions in: scripts/ui-suggestions.json
2. Icons generated in: {icons_dir}
3. Icon component created: src/components/PokerIcon.tsx

To use the new icons, import PokerIcon:
  import {{ PokerIcon }} from './components/PokerIcon';

Then replace emojis like:
  Before: <button>📚 Tutorial</button>
  After:  <button><PokerIcon name="tutorial" size={{20}} /> Tutorial</button>
""")

if __name__ == "__main__":
    main()
