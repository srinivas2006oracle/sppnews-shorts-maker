import sys
import subprocess
import os

def merge_videos_with_audio(input1, input2, output):
    # Use ffmpeg concat demuxer for safest merge with audio
    concat_file = 'concat_list.txt'
    with open(concat_file, 'w') as f:
        f.write(f"file '{os.path.abspath(input1)}'\n")
        f.write(f"file '{os.path.abspath(input2)}'\n")
    
    cmd = [
        'ffmpeg',
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_file,
        '-c', 'copy',
        output
    ]
    try:
        subprocess.check_call(cmd)
    finally:
        if os.path.exists(concat_file):
            os.remove(concat_file)

if __name__ == '__main__':
    if len(sys.argv) != 4:
        print('Usage: python merge_videos.py <input1.mp4> <input2.mp4> <output.mp4>')
        sys.exit(1)
    merge_videos_with_audio(sys.argv[1], sys.argv[2], sys.argv[3])
