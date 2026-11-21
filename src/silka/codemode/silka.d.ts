/**
 * Silka Code Mode API v1.4.0 (compatible con 1.0.x–1.3.x)
 * @module silka
 */

export declare const SILKA_API_VERSION: '1.4.0';

export type SilkaErrorCode =
  | 'E_SYNTAX'
  | 'E_POLICY'
  | 'E_LIMIT'
  | 'E_SCOPE'
  | 'E_NOT_FOUND'
  | 'E_CONFLICT'
  | 'E_NOT_IMPLEMENTED'
  | 'E_HUB'
  | 'E_RUNTIME'
  | 'E_TASK_INVALID'
  | 'E_STALE';

export type AcceptCriterion =
  | { cmd: string }
  | { grep: { pattern: string; path: string; absent?: boolean } }
  | { file: { path: string; exists?: boolean } };

export interface TaskSpec {
  title: string;
  scope?: string | string[];
  deliver?: string;
  /** Si falta, Silka infiere desde el worktree (verifySource: inferido). */
  verify?: string | string[];
  accept?: AcceptCriterion[];
  allowNoVerify?: boolean;
  maxRepairs?: number;
  agent?: string;
  model?: string;
  prompt?: string;
  workspace?: string;
  dependsOn?: string[];
  /**
   * Comandos de preparación del worktree (p. ej. `npm ci`). Si faltan, Silka infiere desde lockfiles del repo.
   */
  setup?: string | string[];
  /**
   * `link` reutiliza `node_modules` del repo cuando el lockfile coincide; `install` corre `setup` en el worktree.
   */
  setupMode?: 'link' | 'install';
}

export interface TaskEvidenceItem {
  kind: 'verify' | 'accept';
  ok: boolean;
  durationMs?: number;
  ref?: string | null;
  cmd?: string;
  exitCode?: number | null;
  type?: 'cmd' | 'grep' | 'file';
  pattern?: string;
  path?: string;
  detail?: string;
}

export interface DeliveryCard {
  id: string;
  gates: 'pass' | 'fail';
  evidence: TaskEvidenceItem[];
  verifySource?: 'declarado' | 'inferido' | 'ninguno';
  agentSays: string;
  agentSaysFrom?: 'agente';
  verify: { ok: boolean; ref?: string };
  risk: string;
  [key: string]: unknown;
}

export interface LaunchOptions {
  agent?: string;
  model?: string;
  workspace?: string;
  mode?: string;
  timeoutSeconds?: number;
  /**
   * Con `worktree`, crea rama `silka/<id>` y worktree aislado por tarea (F2) en lugar de sesiones en el workspace actual.
   */
  isolate?: 'worktree';
  /** Límite de tareas concurrentes cuando `isolate` es `worktree`. */
  maxConcurrentTasks?: number;
}

export interface WaitOptions {
  timeoutSeconds?: number;
}

export interface SendOptions {
  now?: boolean;
}

export interface SessionCard {
  sessionId: string;
  status: string;
  agentId?: string;
  summary?: string;
  workspace?: string;
  /** Número de turno completado o en curso (desde el hub). */
  turn?: number;
  /** Último texto del agente en ese turno (desde eventos de sesión). */
  lastMessage?: string;
  /** true si el turno terminó sin texto del agente. */
  noText?: boolean;
}

export interface StateSummary {
  text: string;
}

export interface AgentInfo {
  agentId: string;
  agentName?: string;
  status?: string;
}

export interface ModelInfo {
  agent: string;
  id: string;
  name?: string;
}

export interface PlanWaveStatus {
  index: number;
  status: string;
  taskIds: string[];
  tasks: Array<{ id: string; state: string; wave: number; mergeCommit: string | null; blockedReason: string | null }>;
  evidence: TaskEvidenceItem[] | null;
  culpritTaskId: string | null;
  waveCard: Record<string, unknown> | null;
  blockedReason: string | null;
  mergeCommits: Array<{ taskId: string; commit: string; at?: string }>;
  passedAtCommit: string | null;
}

export interface PlanStatus {
  id: string;
  integration: { verify?: string[]; accept?: AcceptCriterion[]; maxRepairs?: number; verifySource?: string } | null;
  destBaseline: string | null;
  waves: PlanWaveStatus[];
}

export interface SilkaPlan {
  /**
   * Construye un plan desde un archivo de tareas (F2).
   */
  fromFile(path: string): Promise<TaskSpec[]>;
  /**
   * Construye un plan desde una lista en memoria.
   */
  fromList(items: TaskSpec[]): Promise<TaskSpec[]>;
  /** Estado de oleadas e integración (I). */
  status(planId: string): Promise<PlanStatus>;
}

export interface SilkaState {
  /** Resumen compacto del workspace actual. */
  summary(): Promise<StateSummary>;
  /** Cambios registrados desde una fecha ISO. */
  changes(since?: string): Promise<string>;
  /** Anota una decisión de proyecto. */
  decide(text: string): Promise<string>;
}

export interface SilkaAgents {
  /** Agentes disponibles en el hub. */
  list(): Promise<AgentInfo[]>;
  /** Modelos soportados para un agente. */
  models(agent: string): Promise<ModelInfo[]>;
  /** Estadísticas de uso (F5). */
  stats(agent: string, model: string): Promise<Record<string, unknown>>;
}

export interface SilkaReview {
  inbox(): Promise<unknown[]>;
  approve(id: string): Promise<void>;
  reject(id: string, note: string): Promise<void>;
  discard(id: string): Promise<void>;
}

export interface SilkaMerge {
  queue(): Promise<unknown[]>;
  status(id: string): Promise<unknown>;
}

export interface Silka {
  plan: SilkaPlan;
  state: SilkaState;
  agents: SilkaAgents;
  review: SilkaReview;
  merge: SilkaMerge;

  /**
   * Lanza una o varias tareas en el hub (sesiones en segundo plano).
   */
  launch(planOrTask: TaskSpec | TaskSpec[], opts?: LaunchOptions): Promise<SessionCard | SessionCard[]>;

  /**
   * Espera a que una sesión deje de estar ocupada.
   */
  wait(id: string, opts?: WaitOptions): Promise<SessionCard>;

  /**
   * Espera a varias sesiones; el bridge resuelve la espera larga.
   */
  waitAll(ids: string[], opts?: WaitOptions): Promise<SessionCard[]>;

  /** Estado actual de una sesión. */
  status(id: string): Promise<SessionCard>;

  /** Ficha de entrega (F2). */
  card(id: string): Promise<DeliveryCard>;

  /**
   * Recupera una referencia emitida por Silka (`out:<id>`, etc.).
   */
  get(ref: string): Promise<unknown>;

  /** Envía texto a una sesión (cola o inmediato con now). */
  send(id: string, text: string, opts?: SendOptions): Promise<string>;

  /** Cancela una sesión en el hub. */
  cancel(id: string): Promise<SessionCard>;
}

export declare const silka: Silka;