import { UserFacingError } from './error-feedback';
import { api, csrf } from '../api/client';
function requireWebAuthn() {
  if (
    !window.PublicKeyCredential ||
    !isSecureContext ||
    typeof PublicKeyCredential.parseCreationOptionsFromJSON !== 'function' ||
    typeof PublicKeyCredential.parseRequestOptionsFromJSON !== 'function'
  )
    throw new UserFacingError(
      'Для ключа доступа нужен современный браузер и безопасное соединение. Обновите браузер или используйте другое устройство с вашим ключом.',
    );
}
export async function registerPasskey(label: string) {
  requireWebAuthn();
  const { data, error } = await api.POST('/api/v1/auth/webauthn/registration/options', {
    headers: await csrf(),
  });
  if (error || !data) throw error;
  if (
    !data.challenge ||
    !data.user?.id ||
    !data.user.name ||
    !data.rp?.id ||
    !data.pubKeyCredParams
  )
    throw new UserFacingError('Неполные параметры регистрации ключа.');
  const options = PublicKeyCredential.parseCreationOptionsFromJSON({
    challenge: data.challenge,
    rp: { id: data.rp.id, name: data.rp.name ?? 'Ласточка' },
    user: {
      id: data.user.id,
      name: data.user.name,
      displayName: data.user.displayName ?? data.user.name,
    },
    pubKeyCredParams: data.pubKeyCredParams.map((p) => {
      if (typeof p.alg !== 'number') throw new UserFacingError('Неподдерживаемый алгоритм ключа.');
      return { type: 'public-key' as const, alg: p.alg };
    }),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none',
    timeout: 300000,
  });
  const result = await navigator.credentials.create({ publicKey: options });
  if (!(result instanceof PublicKeyCredential)) throw new UserFacingError('Ключ не создан.');
  const c = result.toJSON();
  if (!('attestationObject' in c.response))
    throw new UserFacingError('Получен неверный тип ответа.');
  const r = await api.POST('/api/v1/auth/webauthn/registration/finish', {
    headers: await csrf(),
    body: {
      label,
      credential: {
        id: c.id,
        rawId: c.rawId,
        type: 'public-key' as const,
        response: {
          attestationObject: c.response.attestationObject,
          clientDataJSON: c.response.clientDataJSON,
          transports: c.response.transports ?? [],
        },
        clientExtensionResults: {},
      },
    },
  });
  if (r.error) throw r.error;
}
export async function authenticatePasskey() {
  requireWebAuthn();
  const { data, error } = await api.POST('/api/v1/auth/webauthn/authentication/options', {
    headers: await csrf(),
  });
  if (error || !data) throw error;
  if (!data.challenge || !data.rpId) throw new UserFacingError('Неполные параметры входа.');
  const options = PublicKeyCredential.parseRequestOptionsFromJSON({
    challenge: data.challenge,
    rpId: data.rpId,
    userVerification: 'required',
    timeout: 300000,
    allowCredentials: (data.allowCredentials ?? []).map((c) => {
      if (!c.id) throw new UserFacingError('Неверный идентификатор ключа.');
      return { id: c.id, type: 'public-key' as const };
    }),
  });
  const result = await navigator.credentials.get({ publicKey: options });
  if (!(result instanceof PublicKeyCredential)) throw new UserFacingError('Вход отменён.');
  const c = result.toJSON();
  if (!('authenticatorData' in c.response))
    throw new UserFacingError('Получен неверный тип ответа.');
  const r = await api.POST('/api/v1/auth/webauthn/authentication/finish', {
    headers: await csrf(),
    body: {
      credential: {
        id: c.id,
        rawId: c.rawId,
        type: 'public-key' as const,
        response: {
          authenticatorData: c.response.authenticatorData,
          clientDataJSON: c.response.clientDataJSON,
          signature: c.response.signature,
          userHandle: c.response.userHandle ?? undefined,
        },
        clientExtensionResults: {},
      },
    },
  });
  if (r.error) throw r.error;
}
