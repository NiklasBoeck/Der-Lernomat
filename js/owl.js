// Die Lernomat-Eule: Maskottchen der App. Als SVG gezeichnet, damit sie blinzeln, flattern und schreiben kann.
// Die Bewegungen kommen aus css/style.css (Abschnitt „Eule“).

export function owlSVG({ cap = false, pencil = false, cls = '' } = {}) {
  return `<svg class="owl-svg ${cls}" viewBox="0 0 120 130" aria-hidden="true">
  <g class="owl-bob">
    <g class="owl-wing wl"><path d="M24 62c-12 8-15 30-6 44 4-12 10-22 18-28z" fill="#6E4527"/></g>
    <g class="owl-wing wr"><path d="M96 62c12 8 15 30 6 44-4-12-10-22-18-28z" fill="#6E4527"/></g>
    <path d="M30 34 22 10l22 14M90 34l8-24-22 14" fill="#8B5A33"/>
    <ellipse cx="60" cy="72" rx="38" ry="44" fill="#8B5A33"/>
    <ellipse cx="60" cy="86" rx="25" ry="27" fill="#EBCB9C"/>
    <path d="M47 80q4 4 8 0M57 80q4 4 8 0M67 80q4 4 8 0M52 92q4 4 8 0M62 92q4 4 8 0M57 104q4 4 8 0" stroke="#C99C66" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="43" cy="50" r="17" fill="#F6E7CF"/><circle cx="77" cy="50" r="17" fill="#F6E7CF"/>
    <g class="owl-eyes">
      <circle cx="43" cy="50" r="11" fill="#fff"/><circle cx="77" cy="50" r="11" fill="#fff"/>
      <g class="owl-pupils"><circle cx="45" cy="51" r="6.5" fill="#2B2118"/><circle cx="79" cy="51" r="6.5" fill="#2B2118"/>
        <circle cx="47.5" cy="48.5" r="2.2" fill="#fff"/><circle cx="81.5" cy="48.5" r="2.2" fill="#fff"/></g>
      <g class="owl-lids"><rect x="31" y="38" width="24" height="24" rx="12" fill="#8B5A33"/><rect x="65" y="38" width="24" height="24" rx="12" fill="#8B5A33"/></g>
    </g>
    <path d="M55 60h10l-5 10z" fill="#F2A23A" stroke="#D9862A" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M44 114c-2 4-6 6-6 6M48 115v6M52 114c2 4 6 6 6 6M68 114c-2 4-6 6-6 6M72 115v6M76 114c2 4 6 6 6 6" stroke="#F2A23A" stroke-width="3.2" stroke-linecap="round" fill="none"/>
    ${cap ? `<g class="owl-cap"><path d="M60 6 26 20l34 13 34-13z" fill="#2E3350"/><path d="M42 26v9c0 5 36 5 36 0v-9l-18 7z" fill="#3B4166"/>
      <path d="M92 21v14" stroke="#F2B63D" stroke-width="2.4" stroke-linecap="round"/><circle cx="92" cy="37" r="3" fill="#F2B63D"/></g>` : ''}
    ${pencil ? `<g class="owl-pencil"><rect x="88" y="78" width="7" height="34" rx="2" transform="rotate(30 91 95)" fill="#F2B63D"/>
      <path d="M82 108l3 9 5-6z" fill="#3A2C22" transform="rotate(0)"/></g>` : ''}
  </g>
</svg>`;
}

// Die Eule fliegt herein und arbeitet am Lernset (Papier, Stift, Funken). Gibt eine Funktion zum Beenden zurück.
export function owlAtWork(container, { title = '', line = '' } = {}) {
  container.innerHTML = `<div class="owl-work">
    <div class="owl-stage">
      <div class="owl-paper"><i></i><i></i><i></i><i></i><span class="owl-scribble"></span></div>
      <div class="owl-flyer">${owlSVG({ cap: true, pencil: true, cls: 'working' })}</div>
      <span class="owl-spark s1">✦</span><span class="owl-spark s2">✧</span><span class="owl-spark s3">✦</span>
      <span class="owl-sheet sh1"></span><span class="owl-sheet sh2"></span><span class="owl-sheet sh3"></span>
    </div>
    <b class="owl-title">${title}</b><p class="owl-line" id="waitLine">${line}</p>
  </div>`;
  const el = container.querySelector('.owl-work');
  return {
    el,
    // Am Ende: Eule jubelt kurz und fliegt davon.
    done: () => new Promise(res => { el.classList.add('owl-done'); setTimeout(res, 900); }),
  };
}

// Die Eule fliegt einmal quer über den Bildschirm (z. B. wenn etwas fertig ist).
export function owlFlyBy() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const d = document.createElement('div');
  d.className = 'owl-flyby';
  d.innerHTML = owlSVG({ cls: 'flying' });
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
