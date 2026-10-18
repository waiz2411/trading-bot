import urllib.request
import json
import re

url = 'https://www.youtube.com/watch?v=N7uP9V0Iktc'
req = urllib.request.Request(
    url, 
    headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    }
)

html = urllib.request.urlopen(req).read().decode('utf-8')
match = re.search(r'"captionTracks":\[(.*?)\]', html)
if match:
    tracks = json.loads('[' + match.group(1) + ']')
    track_url = tracks[0].get('baseUrl') + '&fmt=json3'
    print("Fetching from:", track_url)
    captions_req = urllib.request.Request(track_url, headers={'User-Agent': 'Mozilla/5.0'})
    raw_data = urllib.request.urlopen(captions_req).read().decode('utf-8')
    data = json.loads(raw_data)
    events = data.get('events', [])
    full_text = []
    for ev in events:
        segs = ev.get('segs', [])
        for s in segs:
            full_text.append(s.get('utf8', ''))
    
    transcript = " ".join("".join(full_text).split())
    with open('yt_transcript.txt', 'w', encoding='utf-8') as f:
        f.write(transcript)
    print("SUCCESS! Transcript written. Total length:", len(transcript))
    print("\n--- TRANSCRIPT PREVIEW (FIRST 2000 CHARS) ---")
    print(transcript[:2000])
