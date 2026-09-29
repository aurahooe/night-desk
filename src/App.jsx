import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

const pages = ['hour', 'room', 'desk', 'door']

function hourKey(d = new Date()) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const h = String(d.getUTCHours()).padStart(2, '0')
  return `${y}-${m}-${day}T${h}`
}

function formatSlot(key) {
  if (!key) return ''
  const [date, h] = key.split('T')
  return `${date} · ${h}:00 UTC`
}

export default function App() {
  const [page, setPage] = useState('hour')
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [edition, setEdition] = useState(null)
  const [featured, setFeatured] = useState(null)
  const [publicNotes, setPublicNotes] = useState([])
  const [mine, setMine] = useState([])
  const [authMode, setAuthMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [handle, setHandle] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 15000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    loadPublic()
  }, [tick])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setMine([])
      return
    }
    loadMine(session.user.id)
  }, [session])

  async function loadPublic() {
    const key = hourKey()
    const { data: hour } = await supabase.from('desk_hours').select('*').eq('hour_key', key).maybeSingle()
    setEdition(hour)
    if (hour?.featured_note_id) {
      const { data: note } = await supabase.from('desk_notes').select('*').eq('id', hour.featured_note_id).maybeSingle()
      setFeatured(note)
    } else {
      setFeatured(null)
    }
    const { data: notes } = await supabase.from('desk_notes').select('*').eq('is_public', true).order('created_at', { ascending: false }).limit(24)
    setPublicNotes(notes || [])
  }

  async function loadMine(uid) {
    const { data: p } = await supabase.from('desk_profiles').select('*').eq('id', uid).maybeSingle()
    setProfile(p)
    const { data: notes } = await supabase.from('desk_notes').select('*').eq('author_id', uid).order('created_at', { ascending: false })
    setMine(notes || [])
  }

  async function sign() {
    setBusy(true)
    setNotice('')
    try {
      if (authMode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        setPage('desk')
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.user) {
          const h = (handle || email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'desk'
          await supabase.from('desk_profiles').insert({
            id: data.user.id,
            handle: h + Math.floor(Math.random() * 90 + 10),
            display_name: displayName || h,
          })
        }
        setNotice(data.session ? 'Desk unlocked.' : 'Check your email to confirm, then come back.')
      }
    } catch (e) {
      setNotice(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function finishProfile() {
    if (!session) return
    setBusy(true)
    try {
      const h = handle.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)
      const { error } = await supabase.from('desk_profiles').upsert({
        id: session.user.id,
        handle: h,
        display_name: displayName || h,
      })
      if (error) throw error
      await loadMine(session.user.id)
    } catch (e) {
      setNotice(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNote() {
    if (!session) return
    setBusy(true)
    setNotice('')
    try {
      const { error } = await supabase.from('desk_notes').insert({
        author_id: session.user.id,
        title: title.trim(),
        body: body.trim(),
        is_public: isPublic,
      })
      if (error) throw error
      setTitle('')
      setBody('')
      setIsPublic(false)
      setNotice(isPublic ? 'Filed in the public room.' : 'Kept in your drawer.')
      await loadMine(session.user.id)
      await loadPublic()
    } catch (e) {
      setNotice(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function togglePublic(note) {
    await supabase.from('desk_notes').update({ is_public: !note.is_public, updated_at: new Date().toISOString() }).eq('id', note.id)
    await loadMine(session.user.id)
    await loadPublic()
  }

  async function removeNote(note) {
    await supabase.from('desk_notes').delete().eq('id', note.id)
    await loadMine(session.user.id)
    await loadPublic()
  }

  const nextHour = useMemo(() => {
    const d = new Date()
    d.setUTCMinutes(60, 0, 0)
    const left = d.getTime() - Date.now()
    const m = Math.max(0, Math.floor(left / 60000))
    const s = Math.max(0, Math.floor((left % 60000) / 1000))
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }, [tick])

  return (
    <div className="shell">
      <div className="grain" aria-hidden="true" />
      <header className="top">
        <button className="mark" onClick={() => setPage('hour')}>
          <span className="lamp" />
          The Night Desk
        </button>
        <nav>
          {pages.map((p) => (
            <button key={p} className={page === p ? 'on' : ''} onClick={() => setPage(p)}>
              {p === 'hour' ? 'This hour' : p === 'room' ? 'Public room' : p === 'desk' ? 'Your desk' : 'Door'}
            </button>
          ))}
        </nav>
        <div className="clock">
          <em>next turn</em>
          <strong>{nextHour}</strong>
        </div>
      </header>
      <main>
        {page === 'hour' && (
          <section className="edition enter">
            <p className="kicker">{formatSlot(edition?.hour_key || hourKey())}</p>
            <h1>{edition?.headline || 'The lamp is still warming.'}</h1>
            <p className="lede">{edition?.body || 'Every hour this desk writes a short edition and pins one public note, if anyone left one out. Sit down. Leave something. Or just read.'}</p>
            {featured && (
              <article className="pin">
                <span>Pinned this hour</span>
                <h2>{featured.title}</h2>
                <p>{featured.body}</p>
              </article>
            )}
          </section>
        )}
        {page === 'room' && (
          <section className="grid enter">
            <header className="sec">
              <h1>Public room</h1>
              <p>Anything marked public lands here. Private notes stay in your drawer.</p>
            </header>
            {publicNotes.length === 0 && <p className="empty">Quiet so far. Be the first to leave a page open.</p>}
            <div className="cards">
              {publicNotes.map((n) => (
                <article key={n.id} className="card">
                  <h3>{n.title}</h3>
                  <p>{n.body}</p>
                  <time>{new Date(n.created_at).toLocaleString()}</time>
                </article>
              ))}
            </div>
          </section>
        )}
        {page === 'desk' && (
          <section className="desk enter">
            {!session && (
              <div className="gate">
                <h1>Your desk is locked.</h1>
                <p>Sign in at the door. Notes you keep private never leave your drawer.</p>
                <button onClick={() => setPage('door')}>Open the door</button>
              </div>
            )}
            {session && !profile && (
              <div className="gate">
                <h1>Name the desk.</h1>
                <label>Handle<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="inkwell" /></label>
                <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="M. Vale" /></label>
                <button disabled={busy || handle.length < 2} onClick={finishProfile}>Sit down</button>
              </div>
            )}
            {session && profile && (
              <>
                <header className="sec">
                  <h1>Hello, {profile.display_name}.</h1>
                  <p>@{profile.handle} · drafts stay here unless you mark them public.</p>
                </header>
                <form className="composer" onSubmit={(e) => { e.preventDefault(); saveNote() }}>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" maxLength={140} required />
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the thing you would leave on a desk at midnight." maxLength={8000} required />
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Mark public</label>
                    <button disabled={busy}>{busy ? 'Filing…' : 'File note'}</button>
                  </div>
                </form>
                {notice && <p className="notice">{notice}</p>}
                <ul className="drawer">
                  {mine.map((n) => (
                    <li key={n.id}>
                      <div>
                        <strong>{n.title}</strong>
                        <span className={n.is_public ? 'pub' : 'priv'}>{n.is_public ? 'public' : 'drawer'}</span>
                        <p>{n.body}</p>
                      </div>
                      <div className="acts">
                        <button onClick={() => togglePublic(n)}>{n.is_public ? 'Keep private' : 'Make public'}</button>
                        <button className="ghost" onClick={() => removeNote(n)}>Tear up</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
        {page === 'door' && (
          <section className="door enter">
            <h1>{authMode === 'in' ? 'Come in.' : 'Take a key.'}</h1>
            <p>Email and password. Nothing flashy. Your notes persist on the server.</p>
            <form onSubmit={(e) => { e.preventDefault(); sign() }}>
              <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></label>
              {authMode === 'up' && (
                <>
                  <label>Handle<input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="optional" /></label>
                  <label>Display name<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optional" /></label>
                </>
              )}
              <button disabled={busy}>{busy ? 'Working…' : authMode === 'in' ? 'Unlock' : 'Make a key'}</button>
            </form>
            {notice && <p className="notice">{notice}</p>}
            <button className="texty" onClick={() => { setAuthMode(authMode === 'in' ? 'up' : 'in'); setNotice('') }}>
              {authMode === 'in' ? 'No key yet? Make one.' : 'Already have a key? Come in.'}
            </button>
            {session && (
              <button className="texty" onClick={async () => { await supabase.auth.signOut(); setPage('hour') }}>Lock the desk and leave</button>
            )}
          </section>
        )}
      </main>
      <footer>
        <p>A small room that changes on the hour. Write, keep it, or leave it on the table.</p>
      </footer>
    </div>
  )
}
