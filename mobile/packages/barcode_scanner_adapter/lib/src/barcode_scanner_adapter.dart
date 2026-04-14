import 'scan_result.dart';

/// Format-agnostic barcode scanner abstraction.
/// The BAMUL-confirmed ear tag barcode format is injected at configuration time.
/// Full implementation in Epic 2, Story 2.2.
abstract class BarcodeScannerAdapter {
  /// Starts scanning and emits [ScanResult] for each detected barcode.
  /// The adapter filters by [allowedFormats] — null means accept any format.
  Stream<ScanResult> scan({List<String>? allowedFormats});

  /// Stops the scanner and releases camera resources.
  Future<void> dispose();
}
