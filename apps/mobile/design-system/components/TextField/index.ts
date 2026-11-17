import { Platform } from 'react-native';
import { TextField as AndroidTextField } from './TextField.android';
import { TextField as IOSTextField } from './TextField.ios';
import { AppTextFieldProps } from './TextField.types';

export * from './TextField.types';

export const TextField: React.FC<AppTextFieldProps> =
  Platform.OS === 'ios' ? IOSTextField : AndroidTextField;
