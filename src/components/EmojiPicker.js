'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

// The chat's emoji panel: tabs, a search box, and the ones you used most recently (kept on this device).
// Each line: the emoji, then a few words to find it by.
const DATA = {
  Smileys: `😀 grin smile happy|😃 smile happy|😄 laugh smile|😁 grin teeth|😆 laugh xd|😅 sweat laugh|🤣 rofl laugh floor|😂 joy tears laugh|🙂 smile slight|🙃 upside down|😉 wink|😊 blush smile|😇 angel halo|🥰 love hearts smitten|😍 heart eyes love|🤩 star struck wow|😘 kiss blow|😗 kiss|😚 kiss blush|😙 kiss smile|😋 yum tasty|😛 tongue|😜 wink tongue crazy|🤪 zany crazy|😝 tongue squint|🤗 hug|🤭 giggle oops|🤫 shh quiet|🤔 think hmm|🤐 zip quiet|🤨 eyebrow doubt|😐 neutral|😑 blank|😶 speechless|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace awkward|😌 relieved calm|😔 pensive sad|😪 sleepy|😴 sleep zzz|😷 mask sick|🤒 fever sick|🤧 sneeze|🥵 hot|🥶 cold freezing|🥴 woozy dizzy|😵 dizzy|🤯 mind blown|🤠 cowboy|🥳 party celebrate|😎 cool sunglasses|🤓 nerd|🧐 monocle curious|😕 confused|😟 worried|🙁 frown|😮 wow surprised|😯 hushed|😲 astonished shocked|😳 flushed embarrassed|🥺 pleading puppy eyes|😦 frown open|😧 anguished|😨 fearful scared|😰 anxious sweat|😥 sad relieved|😢 cry tear|😭 sob crying|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 sweat downcast|😩 weary tired|😫 tired|🥱 yawn bored|😤 triumph huff|😡 angry rage|😠 angry mad|🤬 swear cursing|😈 devil smile|💀 skull dead|💩 poop|🤡 clown|👻 ghost|👽 alien|🤖 robot`,
  'People & gestures': `👋 wave hi hello bye|🤚 hand raised|✋ hand stop high five|🖐️ hand fingers|👌 ok perfect|🤌 pinched italian|✌️ peace victory|🤞 fingers crossed luck|🤟 love you|🤘 rock|🤙 call me|👈 left point|👉 right point|👆 up point|👇 down point|☝️ one up|👍 thumbs up yes like|👎 thumbs down no|✊ fist|👊 punch fist bump|👏 clap applause|🙌 raise hands hooray|👐 open hands|🤲 palms|🤝 handshake deal|🙏 pray please thanks|💪 strong muscle|🫶 heart hands|👀 eyes look|👄 lips|💋 kiss mark|🧠 brain|👶 baby|👧 girl|👦 boy|👩 woman|👨 man|👫 couple|💑 couple heart|💏 couple kiss|👰 bride wedding|🤵 groom|🙋 raise hand|🤷 shrug|🤦 facepalm|🙇 bow|💃 dance woman|🕺 dance man|🚶 walk|🏃 run`,
  'Hearts & love': `❤️ red heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🤎 brown heart|🖤 black heart|🤍 white heart|💔 broken heart|❣️ heart exclamation|💕 two hearts|💞 revolving hearts|💓 beating heart|💗 growing heart|💖 sparkling heart|💘 cupid arrow heart|💝 heart gift ribbon|💟 heart decoration|😻 cat heart eyes|💌 love letter|🌹 rose|💐 bouquet flowers|💍 ring engagement|🥂 cheers toast|🍫 chocolate|🧸 teddy bear|🫂 hug people|💯 hundred perfect|✨ sparkles|🔥 fire hot lit|⭐ star|🌟 glowing star|💫 dizzy star`,
  Animals: `🐶 dog puppy|🐱 cat kitten|🐭 mouse|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🙈 see no evil monkey|🙉 hear no evil|🙊 speak no evil|🐔 chicken|🐧 penguin|🐦 bird|🦋 butterfly|🐝 bee|🐞 ladybug|🐢 turtle|🐍 snake|🐙 octopus|🐬 dolphin|🐳 whale|🦈 shark|🐘 elephant|🦒 giraffe|🦓 zebra|🐎 horse|🦄 unicorn|🌸 cherry blossom|🌻 sunflower|🌷 tulip|🌴 palm tree|🌵 cactus|🍀 clover luck|🍁 maple leaf|🌈 rainbow|☀️ sun|🌙 moon|⛅ cloud sun|🌧️ rain|❄️ snow|⚡ lightning`,
  'Food & drink': `🍏 green apple|🍎 apple|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥑 avocado|🍅 tomato|🌽 corn|🥕 carrot|🍞 bread|🥐 croissant|🧀 cheese|🍳 egg breakfast|🥞 pancakes|🍔 burger|🍟 fries|🍕 pizza|🌭 hot dog|🌮 taco|🌯 burrito|🍝 pasta spaghetti|🍜 noodles ramen|🍣 sushi|🍚 rice|🍛 curry|🍗 chicken leg|🥩 meat steak|🍦 ice cream|🍩 donut|🍪 cookie|🎂 birthday cake|🍰 cake slice|🧁 cupcake|🍿 popcorn|☕ coffee tea|🍵 tea|🧃 juice|🥤 soda drink|🍺 beer|🍷 wine|🍸 cocktail|🍾 champagne`,
  Activities: `⚽ football soccer|🏀 basketball|🏈 american football|⚾ baseball|🎾 tennis|🏐 volleyball|🏓 ping pong|🏸 badminton|🥊 boxing|🏋️ gym weights|🚴 cycling bike|🏊 swim|🧘 yoga|🎯 target goal|🎮 game|🎲 dice|🧩 puzzle|🎨 art paint|🎬 movie film|🎤 mic sing karaoke|🎧 headphones music|🎵 music note|🎶 music notes|🎸 guitar|🎹 piano|🥁 drum|🎉 party popper celebrate|🎊 confetti|🎈 balloon|🎁 gift present|🏆 trophy win|🥇 gold medal first|📚 books study|✏️ pencil write|📝 memo note|📅 calendar date|⏰ alarm clock|✅ done check|❌ cross no|❓ question|❗ exclamation`,
  'Travel & places': `🚗 car|🚕 taxi|🚌 bus|🚑 ambulance|🚓 police car|🏍️ motorbike|🚲 bicycle|🛵 scooter|✈️ plane flight|🚀 rocket|🚢 ship|⛵ sailboat|🚆 train|🏠 house home|🏡 home garden|🏢 office building|🏥 hospital|🏫 school|⛪ church|🕌 mosque|🏖️ beach|🏝️ island|⛰️ mountain|🏕️ camping|🗽 statue liberty|🗼 tower|🌍 world globe africa europe|🌃 night city|🌅 sunrise|🌄 sunrise mountains|🎡 ferris wheel|🗺️ map|🧳 luggage travel|⛽ fuel|📍 pin location`,
  Objects: `📱 phone mobile|💻 laptop computer|⌨️ keyboard|🖥️ desktop|📷 camera|📸 camera flash photo|🎥 video camera|📺 tv|⏳ hourglass|💡 idea bulb|🔦 flashlight|💸 money flying|💰 money bag|💳 card|💎 gem diamond|🔧 wrench|🔨 hammer|🔑 key|🔒 lock|🔓 unlock|✉️ envelope mail|📦 package box|📌 pushpin|📎 paperclip|✂️ scissors|🛒 cart shopping|🛏️ bed|🛋️ couch|🚿 shower|🧹 broom clean|🧺 basket laundry|🧼 soap|💊 pill medicine|💉 syringe|🩺 stethoscope|🕯️ candle|🎀 ribbon bow|👗 dress|👟 shoe sneaker|👠 heel|👜 handbag|🕶️ sunglasses|⌚ watch`,
};
const TABS = Object.keys(DATA);
const ALL = TABS.flatMap((tab) => DATA[tab].split('|').map((line) => {
  const [e, ...words] = line.split(' ');
  return { e, words: words.join(' '), tab };
}));
const RECENT = 'chat-emoji-recent';
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT)); return Array.isArray(v) ? v.slice(0, 24) : []; } catch { return []; } };
const saveRecent = (list) => { try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch { /* private window: not kept */ } };
const TAB_ICONS = { Recent: '🕘', Smileys: '😀', 'People & gestures': '👋', 'Hearts & love': '❤️', Animals: '🐶', 'Food & drink': '🍕', Activities: '⚽', 'Travel & places': '✈️', Objects: '💡' };

export default function EmojiPicker({ onPick, onClose }) {
  const [recent, setRecent] = useState([]);
  useEffect(() => setRecent(readRecent()), []);
  const [tab, setTab] = useState(null); // null = Recent if there are some, else the first tab
  const [q, setQ] = useState('');
  const box = useRef(null);
  const tabs = recent.length ? ['Recent', ...TABS] : TABS;
  const shownTab = tab || tabs[0];

  useEffect(() => {
    const down = (e) => {
      if (box.current?.contains(e.target) || e.target.closest?.('[aria-label="Emoji"], [aria-label="Close emoji"]')) return;
      onClose();
    };
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const list = useMemo(() => {
    if (term) return ALL.filter((x) => x.words.includes(term) || x.tab.toLowerCase().includes(term));
    if (shownTab === 'Recent') return recent.map((e) => ({ e }));
    return ALL.filter((x) => x.tab === shownTab);
  }, [term, shownTab, recent]);

  const pick = (e) => {
    onPick(e);
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    saveRecent(next);
  };

  return (
    <div className="emo" ref={box} role="dialog" aria-label="Emoji">
      <div className="emo-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={!term && shownTab === t} title={t} aria-label={t}
            className={!term && shownTab === t ? 'emo-tab on' : 'emo-tab'} onClick={() => { setTab(t); setQ(''); }}>
            {TAB_ICONS[t]}
          </button>
        ))}
      </div>
      <input className="emo-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji"
        aria-label="Search emoji" autoComplete="off" />
      <p className="emo-h">{term ? `Results for “${q.trim()}”` : shownTab}</p>
      <div className="emo-grid">
        {list.length ? list.map((x) => (
          <button key={x.e} type="button" className="emo-e" onClick={() => pick(x.e)} title={x.words || x.e} aria-label={x.words || x.e}>{x.e}</button>
        )) : <p className="emo-none">No emoji found</p>}
      </div>
    </div>
  );
}
