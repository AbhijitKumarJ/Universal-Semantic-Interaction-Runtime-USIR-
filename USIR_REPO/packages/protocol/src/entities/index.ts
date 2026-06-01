/**
 * Semantic Entities — the atomic units of the USIR universe.
 *
 * A SemanticEntity strips away all visual presentation. It doesn't care
 * whether it's rendered as a button on a screen, a 3D hologram in XR,
 * or spoken aloud through earbuds. It only describes its semantic role
 * and its relationships to other entities.
 */

export type EntityRole =
  // Code/Development
  | 'source_file'
  | 'function'
  | 'class'
  | 'variable'
  | 'module'
  | 'package'
  | 'test'
  | 'diagnostic'
  | 'terminal'
  | 'documentation'
  // UI regions
  | 'ui_region'
  | 'panel'
  | 'form_field'
  | 'data_table'
  // Runtime constructs
  | 'error'
  | 'warning'
  | 'task'
  | 'agent'
  | 'user'
  | 'document'
  | 'meeting'
  | 'project'
  | 'relationship'
  // Physical world (Stage 2 expansion)
  | 'physical_device'
  | 'spatial_anchor'
  | 'environmental_sensor'
  // Generic fallbacks
  | 'unknown';

/**
 * Spatial bounds — 2D (legacy) or 3D (XR/IoT).
 * 2D: x, y, width, height in CSS pixels
 * 3D: x, y, z are coordinates; width/height/depth are volumes
 */
export interface SpatialBounds2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialVolume {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation?: { x: number; y: number; z: number; w: number };
}

export type SpatialBounds = SpatialBounds2D | SpatialVolume;

export interface AudioFingerprint {
  /** Phonetically friendly name for voice disambiguation (e.g. "Alpha", "Bravo") */
  phoneticName: string;
  /** Spoken description (e.g. "the wide blue box near the top left") */
  spokenDescription: string;
  /** TTS-speakable identifier */
  spokenId: string;
}

/**
 * The atomic semantic unit. Apps expose these; the runtime never sees UI.
 */
export interface SemanticEntity {
  /** Unique Universal Resource Name, e.g. "file:///src/main.ts#L12" */
  id: string;
  /** Semantic role — what *kind* of thing this is */
  role: EntityRole;
  /** Human-readable name shown in disambiguation */
  displayName: string;
  /** Optional context — file path, function signature, error message, etc. */
  context?: Record<string, unknown>;
  /** Spatial position (screen coordinates or 3D volume) */
  spatial?: SpatialBounds;
  /** Audio fingerprint for voice-first clients */
  audioFingerprint?: AudioFingerprint;
  /** Free-form attributes: color, size, style, semantics */
  attributes: Record<string, unknown>;
  /** Graph edges — relations to other entities */
  relations: EntityRelation[];
  /** Last update timestamp (epoch ms) */
  updatedAt: number;
  /** Source adapter that produced this entity (e.g. "vscode", "browser") */
  source: string;
}

export type RelationKind =
  | 'contains'
  | 'child_of'
  | 'parent_of'
  | 'references'
  | 'depends_on'
  | 'relates_to'
  | 'next_to'
  | 'above'
  | 'below'
  | 'created_by'
  | 'assigned_to'
  | 'generated_from'
  | 'implements'
  | 'extends'
  | 'overrides'
  | 'calls';

export interface EntityRelation {
  kind: RelationKind;
  targetId: string;
  /** Confidence score 0-1 for inferred relations */
  confidence?: number;
}

/**
 * Helper: build a minimal entity
 */
export function createEntity(partial: Partial<SemanticEntity> & Pick<SemanticEntity, 'id' | 'role' | 'displayName'>): SemanticEntity {
  return {
    relations: [],
    attributes: {},
    updatedAt: Date.now(),
    source: 'unknown',
    ...partial,
  };
}
