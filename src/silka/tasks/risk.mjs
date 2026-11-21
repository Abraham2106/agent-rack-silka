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
export function assessRisk({ verifyOk, files, outOfScope, diffLines }) {
  const lines = Number(diffLines) || 0;
  const sens = (files || []).filter(isSensitivePath);
  const reasons = [];
  if (!verifyOk) reasons.push('verify_falló');
  if (outOfScope?.length) reasons.push('fuera_de_scope');
  if (sens.length) reasons.push('archivos_sensibles');
  if (lines > 400) reasons.push('diff_grande');
  let level = 'bajo';
  if (!verifyOk || outOfScope?.length || sens.length || lines > 400) level = 'alto';
  else if (lines > 120) level = 'medio';
  return {
    level,
    reasons,
    sensitiveFiles: sens,
    requiresHuman: sens.length > 0 || level === 'alto',
  };
}