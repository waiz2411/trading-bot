import urllib.request
import json
import re

url = 'https://www.youtube.com/watch?v=N7uP9V0Iktc'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
html = urllib.request.urlopen(req).read().decode('utf-8')
match = re.search(r'"captionTracks":\[(.*?)\]', html)
tracks = json.loads('[' + match.group(1) + ']')
track_url = tracks[0].get('baseUrl')
print('track_url:', track_url)
req2 = urllib.request.Request(track_url, headers={
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
    'Referer': 'https://www.youtube.com/'
})
resp = urllib.request.urlopen(req2)
content = resp.read()
print('content len:', len(content))
print('content preview:', content[:500])
with open('raw_caption.txt', 'wb') as f:
    f.write(content)
