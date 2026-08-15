import { Alert, Platform } from 'react-native';
import { platformConfirm } from '../../src/utils/platformConfirm';

describe('platformConfirm', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
  });

  // Regression test for the production bug: the "excluir" (delete) button
  // on the Despesas screen did nothing when clicked on the web build.
  // Root cause was expenses.tsx calling Alert.alert() directly -- which
  // has no implementation on react-native-web and never invokes its
  // button callbacks. platformConfirm must route web through
  // window.confirm instead, exactly like the already-fixed
  // app/(tabs)/shifts.tsx and PostCard.tsx flows.
  describe('on web', () => {
    // The Jest env under jest-expo is not a browser -- `window` isn't
    // defined by default, same as it wouldn't be relevant on native. Stub
    // it in for these tests to simulate the react-native-web runtime
    // where the real bug happened.
    beforeEach(() => {
      Platform.OS = 'web';
      (global as any).window = { confirm: jest.fn() };
    });

    afterEach(() => {
      delete (global as any).window;
    });

    it('calls onConfirm when window.confirm returns true', () => {
      const onConfirm = jest.fn();
      (window.confirm as jest.Mock).mockReturnValue(true);

      platformConfirm('Excluir despesa', 'Tem certeza?', onConfirm);

      expect(window.confirm).toHaveBeenCalledWith('Excluir despesa\n\nTem certeza?');
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not call onConfirm when window.confirm returns false', () => {
      const onConfirm = jest.fn();
      (window.confirm as jest.Mock).mockReturnValue(false);

      platformConfirm('Excluir despesa', 'Tem certeza?', onConfirm);

      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('never calls Alert.alert on web (the no-op API that caused the bug)', () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      (window.confirm as jest.Mock).mockReturnValue(true);

      platformConfirm('Excluir despesa', 'Tem certeza?', jest.fn());

      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  describe('on native (ios/android)', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('calls Alert.alert with cancel and destructive-confirm buttons wired to onConfirm', () => {
      const onConfirm = jest.fn();
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
        const confirmButton = buttons?.find(b => b.style === 'destructive');
        confirmButton?.onPress?.();
      });

      platformConfirm('Excluir despesa', 'Tem certeza?', onConfirm);

      expect(alertSpy).toHaveBeenCalledWith(
        'Excluir despesa',
        'Tem certeza?',
        expect.arrayContaining([
          expect.objectContaining({ style: 'cancel' }),
          expect.objectContaining({ style: 'destructive' }),
        ])
      );
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not call onConfirm just from Alert.alert being invoked (cancel path)', () => {
      const onConfirm = jest.fn();
      jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      platformConfirm('Excluir despesa', 'Tem certeza?', onConfirm);

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
