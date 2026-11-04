'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { friendlyError } from '@/lib/firebase';
import { addSong, playSong, removeSong } from '@/lib/data';
import { sameSong, searchSongs, songLength } from '@/lib/musicSearch';
import { MAX_MUSIC, MAX_SPOTIFY, askToPlay, kindOf, spotifyEmbed, spotifyInfo, spotifyLink, spotifySearchUrl } from '@/lib/spotify';
import { useToast } from './Toast';

const same = (a, b) => a.type === b.type && a.id === b.id;

// When a song was added, the way Spotify's lists say it: '5 minutes ago', '3 days ago', then 'Oct 2, 2026'
function addedAgo(at) {
  if (!at) return '';
  const s = (Date.now() - at) / 1000;
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'Just now';
  if (s < 3600) return ago(Math.floor(s / 60), 'minute');
  if (s < 86400) return ago(Math.floor(s / 3600), 'hour');
  if (s < 30 * 86400) return ago(Math.floor(s / 86400), 'day');
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const Clock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Length">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" />
  </svg>
);
const PlayIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" /></svg>
);

// The Music page: find songs by name, keep them here, and play them in the sidebar player.
// music: my saved songs, newest first. nowPlaying: the link in the sidebar player ('' = none).
// partner: { name, music } while linked (lib/partner.js): their songs, to play here or add to mine
export default function Music({ user, music, nowPlaying, partner = null }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null); // null = no search yet
  const [active, setActive] = useState(0); // highlighted result, for the arrow keys
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState('');
  const [pending, setPending] = useState(null); // the song I picked, waiting for its Spotify link
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const linkInput = useRef(null);
  const filterInput = useRef(null);

  const playing = nowPlaying ? spotifyEmbed(nowPlaying) : null;
  const playingItem = playing && music.find((m) => same(m, playing));
  const fail = (e) => toast(`Not saved: ${friendlyError(e)}`, 'err');
  // each of these is also noted in my activity (Notifications)
  const play = (item) => { askToPlay(); playSong(user, item, spotifyLink(item), 'pick').catch(fail); };

  // ---- matching songs as I type (Apple's free catalogue), a moment after I stop typing
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); setSearching(false); setSearchErr(''); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      searchSongs(term, ctl.signal)
        .then((r) => { setResults(r); setActive(0); setSearchErr(''); setSearching(false); })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          setSearchErr("Couldn't search right now. Check your connection.");
          setSearching(false);
        });
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  // Picked a song: open it on Spotify (Songs tab, that song by that artist) so I can copy its link
  const openOnSpotify = (song) =>
    window.open(spotifySearchUrl(`${song.title} ${song.artist}`, { tracks: true }), '_blank', 'noopener,noreferrer');
  function pick(song) {
    openOnSpotify(song);
    setPending(song);
    setQ('');
    setErr('');
  }

  // Save a Spotify link to my music and play it. The picked song lends its artist (and cover, if Spotify has none),
  // but only when the link really is that song.
  async function add(text) {
    const found = spotifyEmbed(text);
    if (!found) return setErr('That isn’t a Spotify song, album or playlist link');
    setErr('');
    const had = music.find((m) => same(m, found));
    if (had) {
      setLink('');
      setPending(null);
      play(had);
      return toast(`“${had.title}” is already in your music. Playing it now.`);
    }
    if (music.length >= MAX_MUSIC) return setErr(`You can keep up to ${MAX_MUSIC}. Remove one first.`);
    setAdding(true);
    const info = await spotifyInfo(found);
    setAdding(false);
    const song = found.type === 'track' ? pending : null;
    const match = song && (info.ok ? sameSong(info.title, song.title) : true);
    const item = {
      type: found.type, id: found.id,
      title: info.ok || !match ? info.title : song.title,
      image: info.image || (match ? song.image : ''),
      addedAt: Date.now(),
      ...(match && { artist: song.artist, album: song.album, ms: song.ms }),
    };
    setLink('');
    setPending(null);
    addSong(user, music, item).then(() => toast(`“${item.title}” added to your music`)).catch(fail);
    play(item);
  }

  // ---- Ctrl+V anywhere on the page adds a Spotify link (no need to click into the box first)
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    const onPaste = (e) => {
      if (e.target === filterInput.current) return;
      const text = e.clipboardData?.getData('text') || '';
      if (!spotifyEmbed(text)) return;
      e.preventDefault();
      addRef.current(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  async function pasteAndAdd() {
    try {
      const text = await navigator.clipboard.readText();
      if (spotifyEmbed(text)) return add(text);
      setErr('Your clipboard doesn’t have a Spotify link yet. On Spotify: ⋯ → Share → Copy link.');
    } catch {
      setErr('Your browser didn’t let the app read the clipboard. Press Ctrl+V, or paste into the box below.');
      linkInput.current?.focus();
    }
  }

  function searchKey(e) {
    if (!results?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
    else if (e.key === 'Escape') setQ('');
  }

  const remove = (item) =>
    removeSong(user, music, item, same).then(() => toast(`“${item.title}” removed`)).catch(fail);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? music.filter((m) => `${m.title} ${m.artist || ''}`.toLowerCase().includes(f)) : music;
  }, [music, filter]);

  return (
    <div className="board-wrap music-wrap">
      <header className="bar">
        <div className="bar-left">
          <h1>Music</h1>
          <div className="meta">Find songs and keep them here. They play in the sidebar while you work.</div>
        </div>
      </header>

      {playing && (
        <p className="music-now">
          <span className="music-eq" aria-hidden="true"><i /><i /><i /></span>
          Now playing: <b>{playingItem ? [playingItem.title, playingItem.artist].filter(Boolean).join(' · ') : kindOf(playing.type)}</b>
        </p>
      )}

      <section className="music-sec" aria-labelledby="music-find">
        <h2 id="music-find" className="music-h2">Find a song</h2>
        <div role="search">
          <input type="search" className="music-q" placeholder="Type a song name, e.g. Suzanna" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={searchKey} aria-label="Song name" autoComplete="off"
            aria-controls="music-results" aria-expanded={!!results?.length} />
        </div>

        <form className="music-row-f" onSubmit={(e) => { e.preventDefault(); add(link); }}>
          {/* not type="url": a spotify: link isn't a web address */}
          <input ref={linkInput} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="Have a Spotify link already? Paste it here"
            value={link} maxLength={MAX_SPOTIFY} onChange={(e) => { setLink(e.target.value); setErr(''); }} aria-label="Spotify link" autoComplete="off" />
          <button className="btn" type="submit" disabled={!link.trim() || adding}>{adding ? 'Adding…' : 'Add & play'}</button>
        </form>
        {err && <p className="link-err" role="alert">{err}</p>}
      </section>

      <div className="page-body">
      {(q.trim().length >= 2 || pending) && (
        <section className="music-sec" aria-label="Search results">
        {q.trim().length >= 2 && (
          <div className="music-results" id="music-results" aria-busy={searching}>
            {searchErr ? <p className="link-err" role="alert">{searchErr}</p>
              : results === null ? <p className="music-hint">Searching…</p>
              : results.length === 0 ? <p className="music-hint">No songs found for “{q.trim()}”. Try the artist’s name too.</p>
              : (
                <>
                  <p className="music-hint">Pick the one you mean. Spotify opens on that song so you can copy its link.</p>
                  <div className="trk hit trk-head" aria-hidden="true">
                    <span className="trk-n">#</span><span>Title</span><span className="trk-al">Album</span>
                    <span className="trk-len"><Clock /></span><span />
                  </div>
                  <ul className="music-list">
                    {results.map((s, i) => (
                      <li key={s.key}>
                        <button type="button" className={i === active ? 'trk hit on' : 'trk hit'} onClick={() => pick(s)}
                          onMouseEnter={() => setActive(i)}>
                          <span className="trk-n"><span className="trk-i">{i + 1}</span><span className="trk-pi"><PlayIcon /></span></span>
                          <span className="trk-t">
                            {s.image
                              ? <img className="music-cover" src={s.image} alt="" width="40" height="40" loading="lazy" />
                              : <span className="music-cover blank" aria-hidden="true">♪</span>}
                            <span className="trk-tt">
                              <b>{s.title}</b>
                              <span>{s.explicit && <span className="music-e" title="Explicit">E</span>}{s.artist}</span>
                            </span>
                          </span>
                          <span className="trk-al">{[s.album, s.year].filter(Boolean).join(' · ')}</span>
                          <span className="trk-len">{songLength(s.ms)}</span>
                          <span className="music-go" aria-hidden="true">Add ↗</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            <a className="music-more" href={spotifySearchUrl(q)} target="_blank" rel="noopener noreferrer">
              Not here? Search “{q.trim()}” on Spotify ↗
            </a>
          </div>
        )}

        {pending && (
          <div className="music-wait" role="status">
            {pending.image && <img className="music-cover" src={pending.image} alt="" width="48" height="48" />}
            <div className="music-wait-t">
              <p>Waiting for <b>“{pending.title}”</b> by {pending.artist}</p>
              <p className="music-hint">On Spotify, open the song’s ⋯ menu → Share → Copy link, then come back and press <kbd>Ctrl</kbd>+<kbd>V</kbd>.</p>
              <div className="music-wait-b">
                <button className="btn primary" type="button" onClick={pasteAndAdd} disabled={adding}>{adding ? 'Adding…' : 'Paste & add'}</button>
                <button className="btn" type="button" onClick={() => openOnSpotify(pending)}>Open Spotify again</button>
                <button className="btn" type="button" onClick={() => { setPending(null); setErr(''); }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        </section>
      )}

      <section className="music-sec" aria-labelledby="music-mine">
        <div className="music-head">
          <h2 id="music-mine" className="music-h2">My music <span className="count">{music.length}</span></h2>
          {music.length > 5 && (
            <input ref={filterInput} type="search" className="music-filter" placeholder="Find in my music" value={filter}
              onChange={(e) => setFilter(e.target.value)} aria-label="Find in my music" autoComplete="off" />
          )}
        </div>
        {music.length === 0 ? (
          <div className="nt-empty compact">
            <b>No songs yet</b>
            Type a song name above and pick it. It stays here for next time.
          </div>
        ) : shown.length === 0 ? (
          <p className="muted">Nothing matches “{filter}”.</p>
        ) : (
          <>
            {/* laid out like a Spotify track list: # · Title (artist under it) · Album · Date added · length */}
            <div className="trk trk-head" aria-hidden="true">
              <span className="trk-n">#</span><span>Title</span><span className="trk-al">Album</span>
              <span className="trk-d">Date added</span><span className="trk-len"><Clock /></span><span />
            </div>
            <ul className="music-list">
              {shown.map((m) => {
                const on = !!playing && same(m, playing);
                const playMe = () => { if (!on) play(m); };
                return (
                  // a click anywhere on the row plays it (the title is the keyboard way)
                  <li key={`${m.type}:${m.id}`} className={on ? 'trk on' : 'trk'} onClick={playMe}>
                    <span className="trk-n">
                      {on
                        ? <span className="music-eq" aria-hidden="true"><i /><i /><i /></span>
                        : <><span className="trk-i">{music.indexOf(m) + 1}</span><span className="trk-pi"><PlayIcon /></span></>}
                    </span>
                    <button type="button" className="trk-t" onClick={(e) => { e.stopPropagation(); playMe(); }}
                      aria-label={on ? `${m.title}, playing now` : `Play ${m.title}`} aria-current={on || undefined}>
                      {m.image
                        ? <img className="music-cover" src={m.image} alt="" width="40" height="40" loading="lazy" />
                        : <span className="music-cover blank" aria-hidden="true">♪</span>}
                      <span className="trk-tt">
                        <b>{m.title}</b>
                        <span>{m.artist || kindOf(m.type)}</span>
                      </span>
                    </button>
                    <span className="trk-al">{m.album || (m.type === 'track' ? '' : kindOf(m.type))}</span>
                    <span className="trk-d">{addedAgo(m.addedAt)}</span>
                    <span className="trk-len">{songLength(m.ms)}</span>
                    <button className="trk-x" type="button" onClick={(e) => { e.stopPropagation(); remove(m); }}
                      aria-label={`Remove ${m.title}`} title="Remove">✕</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {partner && (
        <section className="music-sec" aria-labelledby="music-partner">
          <div className="music-head">
            <h2 id="music-partner" className="music-h2">{partner.name}&apos;s music <span className="count">{partner.music.length}</span></h2>
          </div>
          {partner.music.length === 0 ? (
            <p className="muted">{partner.name} hasn&apos;t kept any songs yet.</p>
          ) : (
            <ul className="music-list">
              {partner.music.map((m, i) => {
                const on = !!playing && same(m, playing);
                const kept = music.some((x) => same(x, m));
                return (
                  <li key={`p:${m.type}:${m.id}`} className={on ? 'trk on' : 'trk'} onClick={() => { if (!on) play(m); }}>
                    <span className="trk-n">
                      {on
                        ? <span className="music-eq" aria-hidden="true"><i /><i /><i /></span>
                        : <><span className="trk-i">{i + 1}</span><span className="trk-pi"><PlayIcon /></span></>}
                    </span>
                    <button type="button" className="trk-t" onClick={(e) => { e.stopPropagation(); if (!on) play(m); }}
                      aria-label={on ? `${m.title}, playing now` : `Play ${m.title}`} aria-current={on || undefined}>
                      {m.image
                        ? <img className="music-cover" src={m.image} alt="" width="40" height="40" loading="lazy" />
                        : <span className="music-cover blank" aria-hidden="true">♪</span>}
                      <span className="trk-tt">
                        <b>{m.title}</b>
                        <span>{m.artist || kindOf(m.type)}</span>
                      </span>
                    </button>
                    <span className="trk-al">{m.album || (m.type === 'track' ? '' : kindOf(m.type))}</span>
                    <span className="trk-d">{addedAgo(m.addedAt)}</span>
                    <span className="trk-len">{songLength(m.ms)}</span>
                    {kept ? <span className="trk-x" aria-label="In your music" title="In your music">✓</span> : (
                      <button className="trk-x" type="button" title="Add to my music" aria-label={`Add ${m.title} to my music`}
                        onClick={(e) => {
                          e.stopPropagation();
                          addSong(user, music, { ...m, addedAt: Date.now() }).then(() => toast(`“${m.title}” added to your music`)).catch(fail);
                        }}>+</button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      </div>
    </div>
  );
}
