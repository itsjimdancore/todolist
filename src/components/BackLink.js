// "‹ My List" above an open list's or letter's name, on every screen size: back to the page you came from
export default function BackLink({ back }) {
  if (!back) return null;
  return (
    <button className="back-link" type="button" onClick={back.onClick} aria-label={`Back to ${back.label}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      <span>{back.label}</span>
    </button>
  );
}
