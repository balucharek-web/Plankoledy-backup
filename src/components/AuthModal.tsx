import React, { useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  MailCheck,
  RefreshCw,
  UserPlus,
  X,
} from 'lucide-react';
import { auth } from '../firebase';

interface AuthModalProps {
  open: boolean;
  authUser: User | null;
  onClose: () => void;
  onSignInGoogle: () => Promise<void>;
  onUserVerified: (user: User) => void;
}

type AuthTab = 'login' | 'register' | 'reset';

function mapFirebaseAuthError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');

  if (code === 'auth/invalid-email') {
    return 'Podany adres e-mail ma nieprawidłowy format.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'Konto z tym adresem e-mail już istnieje. Zaloguj się w zakładce „Logowanie”.';
  }
  if (code === 'auth/weak-password') {
    return 'Hasło jest zbyt słabe — użyj co najmniej 6 znaków.';
  }
  if (
    code === 'auth/user-not-found' ||
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential'
  ) {
    return 'Nieprawidłowy adres e-mail lub hasło.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Zbyt wiele prób w krótkim czasie. Odczekaj chwilę i spróbuj ponownie.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Logowanie adresem e-mail nie zostało jeszcze włączone w konsoli Firebase (Authentication → Sign-in method → Adres e-mail/hasło).';
  }
  if (code === 'auth/network-request-failed') {
    return 'Brak połączenia z internetem. Sprawdź zasięg i spróbuj ponownie.';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Okno logowania Google zostało zamknięte przed ukończeniem.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Przeglądarka zablokowała wyskakujące okno logowania Google.';
  }

  return msg || 'Wystąpił błąd podczas logowania. Spróbuj ponownie.';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  authUser,
  onClose,
  onSignInGoogle,
  onUserVerified,
}) => {
  const [tab, setTab] = useState<AuthTab>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setInfo(null);
  }, [open, tab]);

  // Close modal automatically once user is fully verified
  useEffect(() => {
    if (open && authUser && authUser.emailVerified) {
      onClose();
    }
  }, [open, authUser, onClose]);

  if (!open) return null;

  const needsVerification = Boolean(authUser && !authUser.emailVerified);

  const handleGoogleClick = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await onSignInGoogle();
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setError('Wpisz adres e-mail i hasło.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      await cred.user.reload();
      if (cred.user.emailVerified) {
        onUserVerified(cred.user);
        onClose();
      } else {
        setInfo(
          'Konto nie zostało jeszcze potwierdzone. Kliknij link w wiadomości e-mail lub wyślij link ponownie.'
        );
      }
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    const cleanName = displayName.trim();

    if (!cleanEmail) {
      setError('Podaj swój adres e-mail.');
      return;
    }
    if (password.length < 6) {
      setError('Hasło musi mieć co najmniej 6 znaków.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Wpisane hasła nie są identyczne.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      auth.languageCode = 'pl';
      const cred = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        password
      );
      if (cleanName) {
        await updateProfile(cred.user, { displayName: cleanName }).catch(
          () => {}
        );
      }
      await sendEmailVerification(cred.user);
      setInfo(
        `Wysłaliśmy link potwierdzający na adres ${cleanEmail}. Otwórz pocztę i kliknij link aktywacyjny.`
      );
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Wpisz adres e-mail powiązany z kontem.');
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      auth.languageCode = 'pl';
      await sendPasswordResetEmail(auth, cleanEmail);
      setInfo(
        `Wysłaliśmy wiadomość z linkiem do ustawienia nowego hasła na adres ${cleanEmail}.`
      );
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerified = async () => {
    const current = auth.currentUser;
    if (!current) return;

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await current.reload();
      if (current.emailVerified) {
        // Force ID token refresh so Firestore rules see email_verified == true immediately
        await current.getIdToken(true);
        onUserVerified(current);
        onClose();
      } else {
        setError(
          'Adres e-mail nie został jeszcze potwierdzony. Otwórz wiadomość na swojej skrzynce (sprawdź też Spam), kliknij link i spróbuj ponownie.'
        );
      }
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleResendVerification = async () => {
    const current = auth.currentUser;
    if (!current) return;

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      auth.languageCode = 'pl';
      await sendEmailVerification(current);
      setInfo(
        `Wysłaliśmy nowy link weryfikacyjny na adres ${current.email ?? ''}.`
      );
    } catch (err) {
      setError(mapFirebaseAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOutPending = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await signOut(auth);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="no-print fixed inset-0 z-[1300] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <h2
              id="auth-modal-title"
              className="text-base font-bold text-slate-900"
            >
              {needsVerification
                ? 'Potwierdź adres e-mail'
                : 'Zaloguj się lub załóż konto'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {needsVerification
                ? 'Ostatni krok przed zapisem parafii w chmurze'
                : 'Zapisz parafie, granice i harmonogramy kolędy na stałe'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij okno logowania"
            className="min-w-[36px] min-h-[36px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {info && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{info}</span>
            </div>
          )}

          {needsVerification && authUser ? (
            /* STEP: WAITING FOR EMAIL LINK CLICK */
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
                  <MailCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Wysłano link aktywacyjny na adres:</span>
                </div>
                <div className="text-sm font-mono font-semibold text-slate-900 break-all">
                  {authUser.email}
                </div>
                <ol className="text-xs text-amber-900 space-y-1 list-decimal list-inside pt-1 leading-relaxed">
                  <li>Otwórz swoją skrzynkę pocztową (sprawdź też folder Spam).</li>
                  <li>Kliknij link potwierdzający z wiadomości.</li>
                  <li>Wróć tutaj i naciśnij przycisk poniżej.</li>
                </ol>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCheckVerified()}
                className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>Potwierdziłem e-mail — aktywuj konto</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleResendVerification()}
                  className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors"
                >
                  Wyślij link ponownie
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSignOutPending()}
                  className="min-h-[40px] px-3 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                >
                  Użyj innego konta
                </button>
              </div>
            </div>
          ) : (
            /* STANDARD LOGIN / REGISTER / RESET VIEW */
            <>
              {/* Quick Google Button */}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGoogleClick()}
                className="w-full min-h-[44px] px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-900 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl inline-flex items-center justify-center gap-2.5 shadow-xs transition-colors"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                  />
                </svg>
                <span>Kontynuuj przez Google</span>
              </button>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200" />
                <span className="shrink mx-3 text-[11px] font-medium text-slate-400">
                  lub dowolny adres e-mail (wp.pl, o2.pl, parafia.pl…)
                </span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              {/* Tabs: Logowanie / Rejestracja */}
              {tab !== 'reset' && (
                <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                      tab === 'login'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LogIn className="w-3.5 h-3.5 text-amber-700" />
                    <span>Mam już konto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('register')}
                    className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                      tab === 'register'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5 text-amber-700" />
                    <span>Załóż nowe konto</span>
                  </button>
                </div>
              )}

              {tab === 'login' && (
                <form onSubmit={(e) => void handleLoginSubmit(e)} className="space-y-3">
                  <div>
                    <label
                      htmlFor="auth-login-email"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Adres e-mail
                    </label>
                    <input
                      id="auth-login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="np. proboszcz@parafia.pl"
                      className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label
                        htmlFor="auth-login-password"
                        className="block text-xs font-medium text-slate-700"
                      >
                        Hasło
                      </label>
                      <button
                        type="button"
                        onClick={() => setTab('reset')}
                        className="text-[11px] font-medium text-amber-800 hover:underline"
                      >
                        Nie pamiętasz hasła?
                      </button>
                    </div>
                    <input
                      id="auth-login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4 text-amber-400" />
                    )}
                    <span>Zaloguj się adresem e-mail</span>
                  </button>
                </form>
              )}

              {tab === 'register' && (
                <form
                  onSubmit={(e) => void handleRegisterSubmit(e)}
                  className="space-y-3"
                >
                  <div>
                    <label
                      htmlFor="auth-reg-name"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Imię lub nazwa (opcjonalnie)
                    </label>
                    <input
                      id="auth-reg-name"
                      type="text"
                      autoComplete="name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="np. Ks. Jan Kowalski"
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="auth-reg-email"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Adres e-mail
                    </label>
                    <input
                      id="auth-reg-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="np. jan.kowalski@wp.pl"
                      className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="auth-reg-pass"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Hasło (min. 6 zn.)
                      </label>
                      <input
                        id="auth-reg-pass"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="auth-reg-pass2"
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Powtórz hasło
                      </label>
                      <input
                        id="auth-reg-pass2"
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={6}
                        value={passwordConfirm}
                        onChange={(e) => setPasswordConfirm(e.target.value)}
                        placeholder="••••••••"
                        className="w-full min-h-[40px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Po rejestracji wyślemy na ten adres wiadomość z linkiem
                    potwierdzającym założenie konta.
                  </p>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-amber-700 hover:bg-amber-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <UserPlus className="w-4 h-4" />
                    )}
                    <span>Załóż konto i wyślij link potwierdzający</span>
                  </button>
                </form>
              )}

              {tab === 'reset' && (
                <form
                  onSubmit={(e) => void handleResetPassword(e)}
                  className="space-y-3"
                >
                  <div className="text-xs text-slate-600 leading-relaxed">
                    Podaj swój adres e-mail — wyślemy wiadomość z linkiem do
                    ustawienia nowego hasła.
                  </div>

                  <div>
                    <label
                      htmlFor="auth-reset-email"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Adres e-mail
                    </label>
                    <input
                      id="auth-reset-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="np. proboszcz@parafia.pl"
                      className="w-full min-h-[42px] px-3 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[44px] py-2.5 px-4 text-xs sm:text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 rounded-xl inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    {busy ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <KeyRound className="w-4 h-4 text-amber-400" />
                    )}
                    <span>Wyślij link do resetu hasła</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTab('login')}
                    className="w-full min-h-[38px] text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Wróć do logowania
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
