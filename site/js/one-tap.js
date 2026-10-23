// Google One Tap：支援 FedCM 的瀏覽器（例如 Android 的 Chrome）會從畫面下方滑出系統的帳號面板，
// 不用切到 accounts.google.com 的分頁。只有 firebaseConfig.googleClientId 有設定時才會用到。
// 面板沒出現、被關掉或載入失敗，就丟出 'one-tap-skipped'，由畫面改用彈出視窗。
import { StoreError } from './shared.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let loading = null;

function loadGis() {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.addEventListener('load', () => (window.google?.accounts?.id ? resolve() : reject(new Error('gsi missing'))));
    script.addEventListener('error', () => reject(new Error(`載入 ${GIS_SRC} 失敗`)));
    document.head.append(script);
  }).catch((e) => {
    loading = null; // 下次再試
    throw e;
  });
  return loading;
}

export function createOneTap(clientId) {
  let initialized = false;
  let pending = null; // 正在等的 { resolve, reject }

  function settle(fn, value) {
    const current = pending;
    pending = null;
    current?.[fn](value);
  }

  async function ready() {
    await loadGis();
    if (initialized) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => settle('resolve', credential),
      use_fedcm_for_prompt: true,
      cancel_on_tap_outside: true,
      context: 'signin',
      itp_support: true,
    });
    initialized = true;
  }

  return {
    // 先把 Google 的程式載好，按下按鈕時面板才出得快
    warmUp() {
      ready().catch(() => {});
    },

    // 回傳 Google ID token
    async prompt() {
      try {
        await ready();
      } catch (e) {
        throw new StoreError('one-tap-skipped', e.message);
      }
      settle('reject', new StoreError('cancelled'));
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        window.google.accounts.id.prompt((moment) => {
          const dismissed = moment.isDismissedMoment() && moment.getDismissedReason() !== 'credential_returned';
          if (moment.isSkippedMoment() || dismissed) {
            if (pending?.reject === reject) settle('reject', new StoreError('one-tap-skipped', moment.getMomentType()));
          }
        });
      });
    },

    cancel() {
      if (!pending) return;
      settle('reject', new StoreError('cancelled'));
      window.google?.accounts?.id?.cancel();
    },
  };
}
