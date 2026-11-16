'use client';
import { useEffect, useState } from 'react';
import { watchPerson } from '@/lib/data';
import { Avatar } from '@/lib/people';
import { CallIcon, useTone } from './CallScreen';

// Someone is calling me: full screen, their photo and name, Decline and Answer.
export default function IncomingCall({ call, name, onAnswer, onDecline }) {
  const [person, setPerson] = useState(null);
  useEffect(() => watchPerson(call.from, setPerson), [call.from]);
  useTone(true, 'ring');
  const video = call.kind === 'video';

  return (
    <div className="call-in" role="alertdialog" aria-modal="true" aria-label={`${name} is calling`}>
      <div className="call-in-who">
        <div className="call-pulse"><Avatar person={{ email: call.from, displayName: name, photoURL: person?.photoURL || '' }} size={112} title={false} /></div>
        <h2>{name}</h2>
        <p>{video ? 'Incoming video call' : 'Incoming voice call'}</p>
      </div>
      <div className="call-in-btns">
        <div className="call-btn-l">
          <button type="button" className="call-btn end" onClick={() => onDecline(call)} aria-label="Decline"><CallIcon name="end" /></button>
          <span>Decline</span>
        </div>
        <div className="call-btn-l">
          <button type="button" className="call-btn answer" onClick={() => onAnswer(call)} aria-label={video ? 'Answer with video' : 'Answer'} autoFocus>
            <CallIcon name={video ? 'video' : 'phone'} />
          </button>
          <span>Answer</span>
        </div>
      </div>
    </div>
  );
}
