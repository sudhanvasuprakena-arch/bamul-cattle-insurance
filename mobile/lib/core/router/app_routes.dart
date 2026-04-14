/// Single source of truth for all route path constants.
/// All GoRoute(path:) declarations reference AppRoutes.* — never raw strings.
abstract class AppRoutes {
  static const String home = '/';
  static const String login = '/login';
  static const String enrollment = '/enrollment';
  static const String enrollmentCapture = '/enrollment/capture';
  static const String enrollmentReview = '/enrollment/review';
  static const String enrollmentConsent = '/enrollment/consent';
  static const String campQueue = '/camp/queue';
  static const String campDashboard = '/camp/dashboard';
  static const String claimFiling = '/claims/new';
  static const String claimDetail = '/claims/:claim_id';
  static const String claimStatus = '/claims/:claim_id/status';
  static const String policyList = '/policies';
  static const String policyDetail = '/policies/:uaid';
  static const String premiumHistory = '/premium/history';
  static const String approverQueue = '/approver/queue';
  static const String agentQueue = '/agent/queue';
  static const String adminDashboard = '/admin';
  static const String settings = '/settings';
  static const String farmerLookup = '/farmer/lookup';
}
