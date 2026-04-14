/// All photo types captured across enrollment and claim filing flows.
enum PhotoType {
  // Enrollment: 5 muzzle angles
  muzzleFront,
  muzzleLeft,
  muzzleRight,
  muzzleTopLeft,
  muzzleTopRight,
  // Enrollment: 4 body shots
  bodyLeft,
  bodyRight,
  bodyFront,
  bodyRear,
  // Claim filing: 4 evidence shots
  carcassLeft,
  carcassRight,
  earTagCloseUp,
  environmentContext,
}
