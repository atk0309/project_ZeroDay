// Challenge 9 — Client cinema. Web. zero.example.com.
//
// Mechanic: a CSS keyframe animation drives a canvas reveal. The flag is
// drawn for ~1% of the cycle (one frame at 60fps), invisible to a casual
// viewer but trivial to capture by pausing the animation in DevTools, or by
// stepping the reveal keyframe at ~99% in the Animations panel.
//
// curl -s on the root path also returns an X-Cinema-Hint header so vintage
// CLI users get a nudge without inspecting HTML.
import type { ChallengeModule } from '../types.js';

const html = (flag: string) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>zero cool — private cinema</title>
<style>
  body{background:#000;color:#0f0;font-family:'Courier New',monospace;padding:3rem;line-height:1.6;}
  h1{font-weight:normal;letter-spacing:.04em;color:#9cf;}
  .stage{
    margin:1.4rem 0;width:560px;max-width:100%;height:120px;
    background:#001;border:1px solid #033;display:grid;place-items:center;
    overflow:hidden;
  }
  canvas{
    width:540px;height:100px;display:block;
    animation: reveal 12s linear infinite;
    opacity:0;
  }
  @keyframes reveal {
    0%, 99% { opacity: 0; }
    99.5%, 100% { opacity: 1; }
  }
  .dim{color:#586;font-size:.95rem;}
</style></head><body>
<h1>zero cool's private cinema</h1>
<pre>
  > the projector hums. it has been humming for hours.
  > a frame slips past every twelve seconds.
  > blink and you'll miss it.
</pre>
<div class="stage">
  <canvas id="reel" width="540" height="100" data-flag="${flag}" aria-label="cinema reel"></canvas>
</div>
<pre class="dim">
  > the operators recommend devtools.
</pre>
<script>
  (function(){
    var c = document.getElementById('reel');
    if (!c || !c.getContext) return;
    var ctx = c.getContext('2d');
    var flag = c.getAttribute('data-flag') || '';
    function paint(){
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#0f0';
      ctx.font = '24px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(flag, c.width/2, c.height/2);
    }
    paint();
    // Re-paint on each animation iteration so the canvas stays loaded even if
    // the user scrubs the timeline manually.
    c.addEventListener('animationiteration', paint);
  })();
</script>
</body></html>`;

export const handler: ChallengeModule = {
  hints: {
    hint1: 'blink and you will miss it.',
    hint2: 'movies are made of frames. one of them is doing all the work.',
    hint3: 'devtools can pause CSS animations.',
    hint4: 'open the canvas in the inspector and step the animation timeline.',
    hint5: 'in DevTools → Animations panel, scrub the `reveal` keyframe to ~99%; the flag is drawn on the canvas there. (or: set animation-play-state: paused in the styles tab.)',
  },

  async page(_req, reply, { flag }) {
    reply.header('X-Cinema-Hint', 'pause-on-frame');
    reply.type('text/html').send(html(flag));
  },
};
