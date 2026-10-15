// Remembers that this driver has seen and agreed to the background-location disclosure on this phone

const KEY = 'orbitride_bg_location_ok';

export const hasAcceptedLocationDisclosure = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export const rememberLocationDisclosure = () => {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* the driver will simply be asked again next time */
  }
};
