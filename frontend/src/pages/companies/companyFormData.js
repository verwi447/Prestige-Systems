const emptyCompany = {
  name: "",
  nip: "",
  regon: "",
  address: "",
  postal_code: "",
  city: "",
  country: "Polska",
  phone: "",
  email: "",
  is_active: true
};

export function createCompanyFormData(company = {}) {
  return {
    ...emptyCompany,
    ...company,
    postal_code: company.postal_code || "",
    is_active: company.is_active !== false
  };
}
