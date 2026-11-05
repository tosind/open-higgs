"""Render and probe a tiny film. Requires FFmpeg and FFprobe on PATH."""
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'FFmpeg and FFprobe are required')
class RenderTest(unittest.TestCase):
    def test_two_stills_and_soundtrack(self):
        folder=ROOT/'work';folder.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='render-',dir=folder) as scratch:
            scratch=pathlib.Path(scratch);clips=[]
            for i,color in enumerate(['red','blue']):
                image=scratch/f'{i}.png'
                subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i',f'color=c={color}:s=320x180','-frames:v','1',str(image)],check=True)
                clips.append({'source':str(image),'duration':1})
            audio=scratch/'music.wav'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=0.5',str(audio)],check=True)
            timeline=scratch/'timeline.json';timeline.write_text(json.dumps({'fps':24,'width':320,'height':180,'clips':clips,'audio':{'source':str(audio),'gain':0.5}}),encoding='utf-8')
            film=scratch/'film.mp4'
            subprocess.run(['python',str(ROOT/'scripts/render_timeline.py'),str(timeline),'--output',str(film)],check=True)
            info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(film)]))
            self.assertAlmostEqual(float(info['format']['duration']),2,places=1)
            self.assertTrue(any(s['codec_name']=='h264' for s in info['streams']))
            self.assertTrue(any(s['codec_name']=='aac' for s in info['streams']))

if __name__=='__main__':unittest.main()
