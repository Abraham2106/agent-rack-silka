import { DEFAULT_SECRET_DENYLIST, deniedFiles } from './denylist.mjs';

const SENSITIVE = [
  /^\.github\//i,
  /^\.gitlab-ci/i,
  /^\.circleci\//i,
  /azure-pipelines/i,
  /jenkinsfile/i,
  /^package\.json$/i,
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /bun\.lockb$/i,
  /^\.silka\//i,
  /\.env(\.|$)/i,
  /secrets?\./i,
  /credentials/i,
];

export function isSensitivePath(file) {
  const norm = String(file).replace(/\\/g, '/');
  return SENSITIVE.some((re) => re.test(norm));
}

/**
 * FR-TK-06: alto si verify falla, fuera de scope, sensibles, o >400 líneas;
 * medio si >120 líneas; si no, bajo.
 */
export function assessRisk({ verifyOk, files, outOfScope, diffLines, allowNoVerify, denylist = DEFAULT_SECRET_DENYLIST }) {
  const lines = Number(diffLines) || 0;
  const sens = (files || []).filter(isSensitivePath);
  // SEC-17: tocar un archivo de la lista de denegación es riesgo alto aunque no sea "sensible".
  const denied = deniedFiles(files, denylist);
  const reasons = [];
  if (allowNoVerify) reasons.push('sin_verify_declarado');
  if (!verifyOk) reasons.push('verify_falló');
  if (outOfScope?.length) reasons.push('fuera_de_scope');
  if (sens.length) reasons.push('archivos_sensibles');
  if (denied.length) reasons.push('archivos_denegados');
  if (lines > 400) reasons.push('diff_grande');
  let level = 'bajo';
  if (allowNoVerify || !verifyOk || outOfScope?.length || sens.length || denied.length || lines > 400) level = 'alto';
  else if (lines > 120) level = 'medio';
  return {
    level,
    reasons,
    sensitiveFiles: [...new Set([...sens, ...denied])],
    deniedFiles: denied,
    requiresHuman: allowNoVerify || sens.length > 0 || denied.length > 0 || level === 'alto',
  };
}