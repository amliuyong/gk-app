export const cityData = {
  beijing: {
    label: '北京市',
    cities: [
      { value: 'beijing', label: '北京市' }
    ]
  },
  tianjin: {
    label: '天津市',
    cities: [
      { value: 'tianjin', label: '天津市' }
    ]
  },
  hebei: {
    label: '河北省',
    cities: [
      { value: 'shijiazhuang', label: '石家庄市' },
      { value: 'tangshan', label: '唐山市' },
      { value: 'qinhuangdao', label: '秦皇岛市' },
      // ... 其他城市
    ]
  },
  shanxi: {
    label: '山西省',
    cities: [
      { value: 'taiyuan', label: '太原市' },
      { value: 'datong', label: '大同市' },
      // ... 其他城市
    ]
  },
  neimenggu: {
    label: '内蒙古自治区',
    cities: [
      { value: 'huhehaote', label: '呼和浩特市' },
      { value: 'baotou', label: '包头市' },
      // ... 其他城市
    ]
  },
  liaoning: {
    label: '辽宁省',
    cities: [
      { value: 'shenyang', label: '沈阳市' },
      { value: 'dalian', label: '大连市' },
      // ... 其他城市
    ]
  },
  // ... 其他省份
};

export const provinces = Object.entries(cityData).map(([value, { label }]) => ({
  value,
  label
})); 