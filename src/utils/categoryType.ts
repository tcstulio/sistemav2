// Mapeamento dos tipos de categoria suportados pelo Dolibarr.
// 0=Produto, 1=Fornecedor, 2=Cliente, 3=Membro, 4=Contato,
// 5=Conta Bancária, 6=Projeto, 7=Armazém

export interface CategoryTypeOption {
    value: string;
    code: string;
    label: string;
}

export const CATEGORY_TYPE_OPTIONS: CategoryTypeOption[] = [
    { value: 'product', code: '0', label: 'Produto' },
    { value: 'supplier', code: '1', label: 'Fornecedor' },
    { value: 'customer', code: '2', label: 'Cliente' },
    { value: 'member', code: '3', label: 'Membro' },
    { value: 'contact', code: '4', label: 'Contato' },
    { value: 'bank_account', code: '5', label: 'Conta Bancária' },
    { value: 'project', code: '6', label: 'Projeto' },
    { value: 'warehouse', code: '7', label: 'Armazém' },
];

const FORM_TO_CODE = new Map(CATEGORY_TYPE_OPTIONS.map(o => [o.value, o.code]));
const CODE_TO_FORM = new Map(
    CATEGORY_TYPE_OPTIONS.flatMap(o => [[o.code, o.value], [o.value, o.value]] as const)
);

// mapeia o código de tipo do Dolibarr (0-7) para o valor do <select> do form
export const typeToForm = (t: string | number): string => {
    return CODE_TO_FORM.get(String(t)) ?? 'product';
};

// mapeia o valor do <select> do form para o código numérico do Dolibarr
export const formToType = (formVal: string): string => {
    return FORM_TO_CODE.get(formVal) ?? '0';
};
