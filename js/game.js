// Lernspiel „Eulen-Blitz“: 60 Sekunden, so viele Fragen wie möglich. Die Eule fiebert mit.
import { esc } from './markdown.js';
import { owlSVG } from './owl.js';
import { sfx } from './audio.js';
import { shuffle } from './ui.js';

const ROUND = 60;
const hsKey = id => 'lernomat.game.' + id;
export function highscore(subjectId) {
  try { return Number(localStorage.getItem(hsKey(subjectId))) || 0; } catch { return 0; }
}
function saveHighscore(subjectId, n) {
  try { localStorage.setItem(hsKey(subjectId), String(n)); } catch { /* egal */ }
}

const plain = s => String(s || '').replace(/\*\*/g, '').replace(/^[-•]\s*/gm, '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + ' …' : s;
const maskTerm = (text, term) => term ? text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\p{L}{0,3}', 'giu'), '…') : text;

// Aus Karteikarten Spielfragen machen: entweder „Welcher Begriff passt?“ oder Frage mit kurzer Antwort.
export function makePairs(cards) {
  const out = [], seen = new Set();
  for (const c of cards) {
    const front = plain(c.front), back = String(c.back || '');
    if (!front || !back) continue;
    const quoted = /„([^“]{2,40})“/.exec(front);
    const cloze = /^\*\*([^*]{1,40})\*\*/.exec(back.trim());
    let p;
    if (cloze) p = { q: front.replace(/^Ergänze:\s*/, ''), a: cloze[1].trim(), kind: 'cloze' };
    else if (quoted && /versteht man|bedeutet|ist mit/i.test(front)) p = { q: cut(maskTerm(plain(back), quoted[1]), 170), a: quoted[1], kind: 'term' };
    else if (front.length <= 40 && !/\?$/.test(front)) p = { q: cut(maskTerm(plain(back), front), 170), a: front, kind: 'term' };
    else p = { q: cut(front, 170), a: cut(plain(back), 110), kind: 'answer' };
    const k = p.q.toLowerCase();
    if (seen.has(k) || p.a.length < 1) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

function question(pairs, last) {
  let p;
  do p = pairs[Math.floor(Math.random() * pairs.length)]; while (pairs.length > 1 && p === last);
  // Falsche Antworten möglichst von derselben Sorte, damit es nicht zu leicht wird.
  const same = pairs.filter(x => x !== p && x.a !== p.a && (x.kind === 'term') === (p.kind === 'term'));
  const pool = same.length >= 2 ? same : pairs.filter(x => x !== p && x.a !== p.a);
  const wrong = shuffle(pool).slice(0, 2).map(x => x.a);
  const options = shuffle([p.a, ...new Set(wrong)]);
  return { p, options, right: options.indexOf(p.a) };
}

const PRAISE = ['Super!', 'Richtig!', 'Klasse!', 'Stark!', 'Genau!', 'Huhu, top!'];

// Startet das Spiel im Container. Gibt eine Aufräum-Funktion zurück.
export function startGame(box, { subj, pairs, onExit }) {
  let timer = null, left = ROUND, score = 0, streak = 0, best = 0, right = 0, total = 0, cur = null, locked = false;
  const hs = highscore(subj.id);

  const intro = () => {
    box.innerHTML = `<div class="game-intro card">
      <div class="game-owl">${owlSVG({ cap: true })}</div>
      <h2>Eulen-Blitz</h2>
      <p>Beantworte in <b>60 Sekunden</b> so viele Fragen wie möglich. Jede richtige Antwort gibt Punkte, mehrere hintereinander geben Bonus 🔥.</p>
      <p class="muted">${pairs.length} Fragen aus „${esc(subj.name)}“${hs ? ` · Rekord: <b>${hs}</b> Punkte` : ''}</p>
      <button class="btn primary block" data-g="go">Los geht's!</button>
    </div>`;
  };

  const play = () => {
    left = ROUND; score = 0; streak = 0; best = 0; right = 0; total = 0; cur = null;
    box.innerHTML = `<div class="game">
      <div class="game-top"><div class="game-time"><i id="gBar"></i></div><span id="gLeft">${ROUND}s</span></div>
      <div class="game-stats"><span>Punkte <b id="gScore">0</b></span><span id="gStreak" class="streak"></span></div>
      <div class="game-board">
        <div class="game-owl small" id="gOwl">${owlSVG()}</div>
        <div class="game-q card" id="gQ"></div>
      </div>
      <div class="game-opts" id="gOpts"></div>
      <div class="game-cheer" id="gCheer" aria-live="polite"></div>
    </div>`;
    next();
    const t0 = Date.now();
    timer = setInterval(() => {
      left = Math.max(0, ROUND - (Date.now() - t0) / 1000);
      const bar = box.querySelector('#gBar');
      if (!bar) return stop();
      bar.style.width = (left / ROUND * 100) + '%';
      bar.classList.toggle('hurry', left < 10);
      box.querySelector('#gLeft').textContent = Math.ceil(left) + 's';
      if (left <= 0) finish();
    }, 100);
  };

  const next = () => {
    cur = question(pairs, cur?.p);
    locked = false;
    const q = box.querySelector('#gQ');
    q.innerHTML = `<small>${cur.p.kind === 'term' ? 'Welcher Begriff passt?' : cur.p.kind === 'cloze' ? 'Was gehört in die Lücke?' : 'Was stimmt?'}</small><p>${esc(cur.p.q)}</p>`;
    q.classList.remove('pop'); void q.offsetWidth; q.classList.add('pop');
    box.querySelector('#gOpts').innerHTML = cur.options.map((o, i) => `<button class="btn game-opt" data-g="pick" data-i="${i}">${esc(o)}</button>`).join('');
  };

  const pick = i => {
    if (locked) return;
    locked = true;
    total++;
    const btns = box.querySelectorAll('.game-opt');
    const owl = box.querySelector('#gOwl .owl-svg');
    const cheer = box.querySelector('#gCheer');
    btns[cur.right].classList.add('right');
    owl.classList.remove('happy', 'sad'); void owl.getBoundingClientRect();
    if (i === cur.right) {
      right++; streak++; best = Math.max(best, streak);
      const pts = 10 + Math.min(streak - 1, 5) * 2;
      score += pts;
      owl.classList.add('happy');
      cheer.textContent = `${PRAISE[Math.floor(Math.random() * PRAISE.length)]} +${pts}`;
      cheer.className = 'game-cheer good';
      sfx('good');
    } else {
      streak = 0;
      btns[i].classList.add('wrong');
      owl.classList.add('sad');
      cheer.textContent = `Richtig wäre: ${cur.p.a}`;
      cheer.className = 'game-cheer bad';
      sfx('bad');
    }
    box.querySelector('#gScore').textContent = score;
    box.querySelector('#gStreak').textContent = streak >= 2 ? `🔥 ${streak} in Folge` : '';
    setTimeout(() => { if (left > 0 && box.querySelector('#gQ')) next(); }, i === cur.right ? 650 : 1500);
  };

  const finish = () => {
    stop();
    const record = score > hs && score > 0;
    if (record) saveHighscore(subj.id, score);
    sfx(record ? 'done' : 'good');
    box.innerHTML = `<div class="game-intro card">
      <div class="game-owl"><div class="owl-svg-wrap">${owlSVG({ cap: true, cls: score > 0 ? 'happy' : 'sad' })}</div></div>
      <h2>${record ? 'Neuer Rekord! 🏆' : 'Zeit ist um!'}</h2>
      <div class="game-result"><b>${score}</b><span>Punkte</span></div>
      <p>${right} von ${total} richtig${best >= 2 ? ` · beste Serie 🔥 ${best}` : ''}${!record && hs ? ` · Rekord: ${hs}` : ''}</p>
      <p class="muted">${total && right / total >= 0.8 ? 'Die Eule ist stolz auf dich!' : total ? 'Übung macht die Eule weise. Noch eine Runde?' : 'Probier es gleich nochmal!'}</p>
      <div class="btn-row" style="justify-content:center"><button class="btn" data-g="exit">Zurück</button><button class="btn primary" data-g="go">Nochmal</button></div>
    </div>`;
  };

  const stop = () => { clearInterval(timer); timer = null; };
  const onClick = e => {
    const b = e.target.closest('[data-g]');
    if (!b) return;
    if (b.dataset.g === 'go') play();
    if (b.dataset.g === 'pick') pick(Number(b.dataset.i));
    if (b.dataset.g === 'exit') onExit();
  };
  box.addEventListener('click', onClick);
  intro();
  return () => { stop(); box.removeEventListener('click', onClick); };
}
