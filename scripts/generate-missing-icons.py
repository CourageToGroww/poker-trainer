#!/usr/bin/env python3
"""Generate only the missing icons"""

import os
import time
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

from google import genai
from google.genai import types

API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY)

MISSING_ICONS = {
    "fold": {
        "prompt": "A minimal, modern icon representing fold action in poker. Single color red icon on transparent background, clean vector style, suitable for dark UI. Simple X or stop symbol.",
        "filename": "fold-icon.png"
    },
    "allin": {
        "prompt": "A minimal, modern icon representing all-in action in poker. Single color orange/red icon on transparent background, clean vector style, suitable for dark UI. Simple flame or explosion symbol.",
        "filename": "allin-icon.png"
    },
    "position": {
        "prompt": "A minimal, modern icon representing table position in poker. Single color white icon on transparent background, clean vector style, suitable for dark UI. Simple position marker or seat indicator.",
        "filename": "position-icon.png"
    }
}

output_dir = Path(__file__).parent.parent / "public" / "icons"

for name, config in MISSING_ICONS.items():
    print(f"Generating {name} icon...")
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
                image_path = output_dir / config["filename"]
                with open(image_path, "wb") as f:
                    f.write(part.inline_data.data)
                print(f"  Saved: {config['filename']}")
                break
    except Exception as e:
        print(f"  Error: {e}")

    time.sleep(2)  # Rate limit delay

print("Done!")
