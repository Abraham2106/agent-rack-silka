import { silkaError } from '../codemode/errors.mjs';

/**
 * §3 política de aprobación (SEC-08).
 * @param {{ risk: string, riskDetail?: { requiresHuman?: boolean }, gates?: string, verify?: { ok?: boolean } }} card
 * @param {'human'|'manager'} actor
 * @param {{ requireHumanForMedium?: boolean }} opts
 */
export function assertCanApprove(card, actor, opts = {}) {
  if (!card) throw silkaError('E_NOT_FOUND', 'La tarea no tiene ficha.');
  if (card.gates !== 'pass' || !card.verify?.ok) {
    throw silkaError('E_POLICY', 'No se puede aprobar: la verificación no pasó.');
  }
  const risk = card.risk || 'bajo';
  const needsHuman = Boolean(card.riskDetail?.requiresHuman) || risk === 'alto';
  if (needsHuman && actor !== 'human') {
    throw silkaError('E_POLICY', 'Riesgo alto o archivos sensibles: solo un humano puede aprobar.');
  }
  if (risk === 'medio' && opts.requireHumanForMedium && actor !== 'human') {
    throw silkaError('E_POLICY', 'Riesgo medio: la política exige aprobación humana.');
  }
  if (actor === 'manager' && !card.verify?.ok) {
    throw silkaError('E_POLICY', 'El manager no puede aprobar sin verificación exitosa.');
  }
}