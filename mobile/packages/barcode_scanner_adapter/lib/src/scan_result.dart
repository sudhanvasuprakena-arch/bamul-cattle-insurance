import 'package:equatable/equatable.dart';

/// Result of a barcode scan attempt.
class ScanResult extends Equatable {
  const ScanResult({required this.rawValue, required this.format});

  final String rawValue;
  final String format; // e.g. 'QR_CODE', 'CODE_128', 'EAN_13' — format-agnostic

  @override
  List<Object?> get props => [rawValue, format];
}
