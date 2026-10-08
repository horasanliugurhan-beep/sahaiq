// Shared by import validation and the briefing guard. Test original literals
// before trimming so controls, format marks and line separators cannot vanish.
export const UNSAFE_LINE_CHARACTER = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
