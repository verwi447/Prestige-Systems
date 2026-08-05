export const emptyClient = {
  company_name: "",
  nip: "",
  address: "",
  postal_code: "",
  city: "",
  country: "",
  contact_person: "",
  phone: "",
  email: ""
};

export const emptyItem = {
  product_id: "",
  name: "",
  code: "",
  unit: "",
  quantity: 1,
  unit_price: 0,
  vat_rate: 23,
  description: ""
};

const formatDate = (date) => (date ? new Date(date).toLocaleDateString("pl-PL") : "");

export const buildDefaultRemarks = (validUntil) =>
  [
    "Forma płatności: Przelew",
    "Termin realizacji: do ustalenia",
    validUntil ? `Ważność oferty: do ${formatDate(validUntil)}` : "Ważność oferty: 30 dni",
    "Do wartości oferty zostanie naliczony podatek VAT."
  ].join("\n");

export const createEmptyOffer = () => {
  const today = new Date().toISOString().slice(0, 10);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  const validUntilValue = validUntil.toISOString().slice(0, 10);

  return {
    offer_number: "",
    title: "",
    description: "",
    customer_id: "",
    client: { ...emptyClient },
    issue_date: today,
    valid_until: validUntilValue,
    salesperson: "",
    currency: "PLN",
    payment_terms: "Przelew",
    payment_due_days: 14,
    delivery_method: "",
    delivery_date: "",
    realization_time: "",
    prepared_by_name: "",
    prepared_by_phone: "",
    prepared_by_email: "",
    remarks: buildDefaultRemarks(validUntilValue),
    additional_info: "",
    status: "SZKIC",
    items: []
  };
};

export const money = (value, currency = "PLN") =>
  new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0)) + ` ${currency}`;

export const normalizeCustomer = (customer = {}) => ({
  company_name: customer.company_name || customer.name || "",
  nip: customer.nip || "",
  address: customer.address || "",
  postal_code: customer.postal_code || "",
  city: customer.city || "",
  country: customer.country || "",
  contact_person: customer.contact_person || customer.name || "",
  phone: customer.phone || "",
  email: customer.email || ""
});

export const normalizeProduct = (product = {}) => ({
  product_id: product.id || "",
  name: product.name || "",
  code: product.code || product.sku || "",
  unit: product.unit || "szt.",
  quantity: 1,
  unit_price: Number(product.sale_price ?? product.catalog_price ?? 0),
  vat_rate: Number(product.vat_rate ?? 23),
  description: product.description || ""
});

export const calculateItem = (item) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  const vatRate = Number(item.vat_rate || 0);
  const net = quantity * unitPrice;
  const vat = net * (vatRate / 100);
  const gross = net + vat;

  return { baseNet: net, net, vat, gross };
};

export const calculateSummary = (items = []) =>
  items.reduce(
    (summary, item) => {
      const calculated = calculateItem(item);
      summary.net += calculated.net;
      summary.vat += calculated.vat;
      summary.gross += calculated.gross;
      return summary;
    },
    { net: 0, vat: 0, gross: 0 }
  );

export const mapOfferFromApi = (offer = {}) => ({
  ...createEmptyOffer(),
  ...offer,
  customer_id: offer.customer_id || "",
  issue_date: (offer.issue_date || offer.created_at || new Date().toISOString()).slice(0, 10),
  valid_until: (offer.valid_until || "").slice(0, 10),
  payment_due_days: offer.payment_due_days ?? 14,
  prepared_by_name: offer.prepared_by_name || offer.salesperson || "",
  prepared_by_phone: offer.prepared_by_phone || "",
  prepared_by_email: offer.prepared_by_email || "",
  client: {
    company_name: offer.client_company_name || offer.company_name || offer.customer_name || "",
    nip: offer.client_nip || offer.customer_nip || "",
    address: offer.client_address || offer.customer_address || "",
    postal_code: offer.client_postal_code || "",
    city: offer.client_city || "",
    country: offer.client_country || "",
    contact_person: offer.client_contact_person || offer.customer_name || "",
    phone: offer.client_phone || offer.customer_phone || "",
    email: offer.client_email || offer.customer_email || ""
  },
  items: (offer.items || []).map((item) => ({
    ...emptyItem,
    product_id: item.product_id || "",
    code: item.code || item.sku || "",
    name: item.name || item.title || "",
    unit: item.unit || "",
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    vat_rate: Number(item.vat_rate ?? offer.vat_rate ?? 23),
    description: item.description || ""
  }))
});

export const buildOfferPayload = (offer, status = offer.status) => ({
  ...offer,
  title: offer.title || "Oferta handlowa",
  status,
  customer_id: offer.customer_id ? Number(offer.customer_id) : null,
  payment_due_days: Number(offer.payment_due_days || 0),
  items: offer.items.map((item) => {
    const calculated = calculateItem(item);
    return {
      ...item,
      title: item.name,
      sku: item.code,
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      vat_rate: Number(item.vat_rate || 0),
      total: calculated.net,
      net_total: calculated.net,
      vat_value: calculated.vat,
      gross_total: calculated.gross
    };
  })
});
