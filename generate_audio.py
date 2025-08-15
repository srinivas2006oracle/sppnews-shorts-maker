from gtts import gTTS
from pydub import AudioSegment
import sys
import os

def generate_audio(text, temp_path):
    tts = gTTS(text=text, lang='te', slow=False)
    tts.save(temp_path)

def increase_audio_speed(input_file, output_file, speed=1.3):
    audio = AudioSegment.from_mp3(input_file)
    audio = audio.speedup(playback_speed=speed)
    audio.export(output_file, format="mp3")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python generate_audio.py <text> <output_path>")
        sys.exit(1)

    text = sys.argv[1]
    output_path = sys.argv[2]
    temp_path = "temp_output.mp3"

    generate_audio(text, temp_path)
    increase_audio_speed(temp_path, output_path, speed=1.3)