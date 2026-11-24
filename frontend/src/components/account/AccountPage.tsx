import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LockKeyhole, Wifi } from 'lucide-react'
import './account-page.css'

type Mode = 'signin' | 'signup'

export function AccountPage() {
  const [mode, setMode] = useState<Mode>('signin')
  const [hasSwitched, setHasSwitched] = useState(false)
  const [signinMessage, setSigninMessage] = useState('')
  const [signupMessage, setSignupMessage] = useState('')
  const formsRef = useRef<HTMLDivElement>(null)
  const signinHeadingRef = useRef<HTMLHeadingElement>(null)
  const signupHeadingRef = useRef<HTMLHeadingElement>(null)
  const previousMode = useRef<Mode>(mode)

  useEffect(() => {
    if (previousMode.current === mode) return
    previousMode.current = mode
    const heading = mode === 'signin' ? signinHeadingRef.current : signupHeadingRef.current
    const timer = window.setTimeout(() => heading?.focus({ preventScroll: true }), 220)
    return () => window.clearTimeout(timer)
  }, [mode])

  useEffect(() => {
    const forms = formsRef.current
    if (!forms) return
    if (typeof ResizeObserver === 'undefined') return

    const measure = () => {
      const active = forms.querySelector<HTMLElement>(mode === 'signin' ? '.account-signin' : '.account-signup')
      if (active) forms.style.setProperty('--forms-height', `${active.offsetHeight}px`)
    }

    const observer = new ResizeObserver(measure)
    forms.querySelectorAll<HTMLElement>('.account-form-pane').forEach((pane) => observer.observe(pane))
    const frame = window.requestAnimationFrame(measure)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [mode])

  function switchMode(next: Mode) {
    setHasSwitched(true)
    setMode(next)
    setSigninMessage('')
    setSignupMessage('')
  }

  function submit(event: FormEvent<HTMLFormElement>, formMode: Mode) {
    event.preventDefault()
    const message = 'La connexion au service de compte n’est pas encore configurée.'
    if (formMode === 'signin') setSigninMessage(message)
    else setSignupMessage(message)
  }

  return (
    <div className="page-shell account-page">
      <h1 className="sr-only">Compte</h1>

      <section className={`account-card surface${mode === 'signup' ? ' is-signup' : ''}`} aria-label="Accès au compte">
        <div className="account-forms" ref={formsRef}>
          <section
            className="account-form-pane account-signin"
            aria-label="Formulaire de connexion"
            aria-hidden={mode !== 'signin'}
            inert={mode !== 'signin'}
          >
            <form className="account-form" onSubmit={(event) => submit(event, 'signin')}>
              <div className="account-mobile-brand" aria-hidden="true"><Wifi /><span>WiFi Heatmapper</span></div>
              <h2 ref={signinHeadingRef} tabIndex={-1}>Ravi de te revoir</h2>
              <p className="account-subtitle">Connecte-toi à ton compte</p>
              <div className="grid gap-3 text-left">
                <label className="grid gap-2">
                  <span className="label">Adresse e-mail</span>
                  <input className="field" type="email" placeholder="nom@exemple.fr" autoComplete="email" required />
                </label>
                <label className="grid gap-2">
                  <span className="label">Mot de passe</span>
                  <input className="field" type="password" placeholder="Ton mot de passe" autoComplete="current-password" required />
                </label>
              </div>
              <button className="account-text-button" type="button" onClick={() => setSigninMessage('La récupération du mot de passe nécessite un service de compte.')}>Mot de passe oublié ?</button>
              <button className="btn-primary btn account-submit" type="submit"><LockKeyhole size={16} /> Se connecter</button>
              <p className="account-status" aria-live="polite">{signinMessage}</p>
              <button className="account-mobile-switch" type="button" onClick={() => switchMode('signup')}>Pas encore de compte ? <span>Créer un compte</span></button>
            </form>
          </section>

          <section
            className="account-form-pane account-signup"
            aria-label="Formulaire de création de compte"
            aria-hidden={mode !== 'signup'}
            inert={mode !== 'signup'}
          >
            <form className="account-form" onSubmit={(event) => submit(event, 'signup')}>
              <div className="account-mobile-brand" aria-hidden="true"><Wifi /><span>WiFi Heatmapper</span></div>
              <h2 ref={signupHeadingRef} tabIndex={-1}>Créer un compte</h2>
              <p className="account-subtitle">Commence ton espace WiFi Heatmapper</p>
              <div className="grid gap-3 text-left">
                <label className="grid gap-2"><span className="label">Nom</span><input className="field" type="text" placeholder="Ton nom" autoComplete="name" required /></label>
                <label className="grid gap-2"><span className="label">Adresse e-mail</span><input className="field" type="email" placeholder="nom@exemple.fr" autoComplete="email" required /></label>
                <label className="grid gap-2"><span className="label">Mot de passe</span><input className="field" type="password" placeholder="8 caractères minimum" autoComplete="new-password" minLength={8} required /></label>
              </div>
              <button className="btn-primary btn account-submit mt-4" type="submit"><LockKeyhole size={16} /> Créer mon compte</button>
              <p className="account-status" aria-live="polite">{signupMessage}</p>
              <button className="account-mobile-switch" type="button" onClick={() => switchMode('signin')}>Tu as déjà un compte ? <span>Se connecter</span></button>
            </form>
          </section>
        </div>

        <aside className="account-promo-track" aria-label="Changer de mode">
          <div className="account-promo">
            <div className="account-promo-content account-promo-signin">
              <span className="account-promo-icon" aria-hidden="true">
                <Wifi size={22} />
                {hasSwitched && mode === 'signin' && <span className="account-wave" />}
              </span>
              <p className="account-eyebrow">WiFi Heatmapper</p>
              <h2>Bonjour !</h2>
              <p>Crée ton compte pour retrouver tes plans et tes relevés au même endroit.</p>
              <button className="btn-secondary btn" type="button" onClick={() => switchMode('signup')}>Créer un compte</button>
            </div>
            <div className="account-promo-content account-promo-signup">
              <span className="account-promo-icon" aria-hidden="true">
                <Wifi size={22} />
                {hasSwitched && mode === 'signup' && <span className="account-wave" />}
              </span>
              <p className="account-eyebrow">WiFi Heatmapper</p>
              <h2>Bon retour !</h2>
              <p>Connecte-toi pour reprendre tes mesures et explorer ta couverture WiFi.</p>
              <button className="btn-secondary btn" type="button" onClick={() => switchMode('signin')}>Se connecter</button>
            </div>
          </div>
        </aside>
      </section>
    </div>
  )
}
