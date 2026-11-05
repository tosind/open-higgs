"""Render an Open Higgs timeline with FFmpeg. Downloads only explicit clip sources."""
import argparse
import json
import pathlib
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('timeline', type=pathlib.Path)
    parser.add_argument('--studio', default='http://127.0.0.1:3161')
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('film.mp4'))
    args = parser.parse_args()
    if not shutil.which('ffmpeg'):
        raise SystemExit('Install FFmpeg and make ffmpeg available on PATH.')
    timeline = json.loads(args.timeline.read_text(encoding='utf-8'))
    clips = timeline.get('clips', [])
    if not clips or any(not clip.get('source') for clip in clips):
        raise SystemExit('Every timeline shot needs a generated or selected output before rendering.')
    fps = int(timeline.get('fps', 24)); width = int(timeline.get('width', 1920)); height = int(timeline.get('height', 1080))
    if fps < 1 or fps > 120 or width < 16 or height < 16 or width > 7680 or height > 7680:
        raise SystemExit('Timeline dimensions or FPS are outside supported limits.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='openhiggs-') as tmp:
        folder = pathlib.Path(tmp)
        parts = []
        for index, clip in enumerate(clips):
            source = clip['source']
            if source.startswith('/api/studio/artifacts/'):
                source = args.studio.rstrip('/') + source
            parsed = urllib.parse.urlparse(source)
            suffix = pathlib.Path(urllib.parse.parse_qs(parsed.query).get('filename', [parsed.path])[0]).suffix.lower()
            if suffix not in {'.png','.jpg','.jpeg','.webp','.mp4','.mov','.webm','.gif'}:
                suffix = '.media'
            if parsed.scheme in ('http','https'):
                target = folder / f'source-{index}{suffix}'
                with urllib.request.urlopen(source, timeout=120) as response, target.open('wb') as output:
                    shutil.copyfileobj(response, output)
            elif parsed.scheme and not pathlib.Path(source).is_absolute():
                raise SystemExit('Only local files and HTTP(S) media sources are supported.')
            else:
                target = pathlib.Path(source).resolve()
                if not target.is_file():
                    raise SystemExit(f'Media source does not exist: {target}')
            duration = float(clip['duration'])
            if duration <= 0 or duration > 120:
                raise SystemExit('Each clip duration must be between 0 and 120 seconds.')
            part = folder / f'part-{index}.mp4'
            # Loop stills, freeze short video at its last frame, normalize size and FPS.
            cmd = ['ffmpeg','-hide_banner','-loglevel','error','-y']
            if suffix in {'.png','.jpg','.jpeg','.webp'}:
                cmd += ['-loop','1']
            cmd += ['-i',str(target),'-an','-vf',f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration={duration},fps={fps},setsar=1','-t',str(duration),'-c:v','libx264','-pix_fmt','yuv420p',str(part)]
            subprocess.run(cmd,check=True)
            parts.append(part)
        listing = folder/'concat.txt'
        listing.write_text('\n'.join("file '" + part.as_posix() + "'" for part in parts),encoding='utf-8')
        audio=timeline.get('audio')
        picture=folder/'picture.mp4' if audio else args.output.resolve()
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(picture)],check=True)
        if audio:
            source=audio['source']
            if source.startswith('/api/studio/artifacts/'):
                source=args.studio.rstrip('/')+source
            parsed=urllib.parse.urlparse(source)
            if parsed.scheme in ('https','http'):
                music=folder/'soundtrack.media'
                with urllib.request.urlopen(source,timeout=120) as response,music.open('wb') as output:
                    shutil.copyfileobj(response,output)
            else:
                music=pathlib.Path(source).resolve()
                if not music.is_file():raise SystemExit('Soundtrack file was not found.')
            gain=max(0,min(1.5,float(audio.get('gain',1))))
            total=sum(float(clip['duration']) for clip in clips)
            fade=min(.7,total/2)
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(picture),'-stream_loop','-1','-i',str(music),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-af',f'volume={gain},afade=t=out:st={max(0,total-fade)}:d={fade}','-t',str(total),'-movflags','+faststart',str(args.output.resolve())],check=True)
    print('Rendered:', args.output.resolve())


if __name__ == '__main__':
    main()
