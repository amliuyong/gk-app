declare module 'solarlunar' {
  interface SolarLunarDate {
    lYear: number;
    lMonth: number;
    lDay: number;
    animal: string;
    monthCn: string;
    dayCn: string;
    gzYear: string;
    gzMonth: string;
    gzDay: string;
  }

  interface SolarLunar {
    solar2lunar: (year: number, month: number, day: number) => SolarLunarDate;
    lunar2solar: (year: number, month: number, day: number, isLeap?: boolean) => SolarLunarDate;
  }

  const solarLunar: SolarLunar;
  export default solarLunar;
} 