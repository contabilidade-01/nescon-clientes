import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, Camera, FileText, Trash2, Eye, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmployeeSelect } from "@/components/EmployeeSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const CertificatesPage = () => {
  const navigate = useNavigate();
  const { company } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [notes, setNotes] = useState("");
  const [certificateDate, setCertificateDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [uploading, setUploading] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Filters
  const currentDate = new Date();
  const [filterMonth, setFilterMonth] = useState(String(currentDate.getMonth()));
  const [filterYear, setFilterYear] = useState(String(currentDate.getFullYear()));

  const years = Array.from({ length: 5 }, (_, i) => currentDate.getFullYear() - i);

  const { data: employees, isLoading: loadingEmployees } = useQuery({
    queryKey: ["employees", company?.id],
    queryFn: () => api.employees.list({ companyId: company!.id }),
    enabled: !!company,
  });

  const { data: certificates, isLoading } = useQuery({
    queryKey: ["certificates", company?.id, filterMonth, filterYear],
    queryFn: async () => {
      const startDate = new Date(Number(filterYear), Number(filterMonth), 1);
      const endDate = new Date(Number(filterYear), Number(filterMonth) + 1, 0);
      return api.certificates.list({
        companyId: company!.id,
        startDate: format(startDate, "yyyy-MM-dd"),
        endDate: format(endDate, "yyyy-MM-dd"),
      });
    },
    enabled: !!company,
  });

  const handleFileSelect = (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máx 10MB)");
      return;
    }
    setPreviewFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleUpload = async () => {
    if (!previewFile || !selectedEmployee || !company) {
      toast.error("Selecione um funcionário e um arquivo");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", previewFile);
      formData.append("company_id", company.id);
      formData.append("employee_id", selectedEmployee);
      formData.append("certificate_date", certificateDate);
      if (notes.trim()) formData.append("notes", notes.trim());

      await api.certificates.upload(formData);

      queryClient.invalidateQueries({ queryKey: ["certificates"] });
      toast.success("Atestado salvo com sucesso!");
      resetForm();
    } catch (err) {
      console.error(err);
      toast.error("Erro ao salvar atestado");
    } finally {
      setUploading(false);
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (cert: { id: string }) => api.certificates.delete(cert.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["certificates"] });
      toast.success("Atestado removido");
    },
    onError: () => toast.error("Erro ao remover"),
  });

  const resetForm = () => {
    setSelectedEmployee("");
    setNotes("");
    setCertificateDate(format(new Date(), "yyyy-MM-dd"));
    setPreviewFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  const employeeName = (empId: string) => {
    return employees?.find((e) => e.id === empId)?.name || "—";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-foreground">Atestados</h1>
            <p className="text-xs text-muted-foreground">{company?.name}</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        {/* Upload Form */}
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-4">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Upload className="h-4 w-4" /> Anexar Atestado
            </h2>

            <EmployeeSelect
              employees={employees ?? []}
              value={selectedEmployee}
              onChange={setSelectedEmployee}
              label="Funcionário *"
              placeholder="Selecione o funcionário"
              loading={loadingEmployees}
            />

            <div>
              <Label>Data do Atestado *</Label>
              <input
                type="date"
                value={certificateDate}
                onChange={(e) => setCertificateDate(e.target.value)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              />
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                placeholder="CID, dias de afastamento, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>

            {/* File/Camera Buttons */}
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> Anexar Arquivo
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera className="h-4 w-4" /> Tirar Foto
              </Button>
            </div>

            {/* Preview */}
            {previewUrl && previewFile && (
              <div className="rounded-lg border p-3 space-y-2">
                <p className="text-sm text-muted-foreground truncate">{previewFile.name}</p>
                {previewFile.type.startsWith("image/") ? (
                  <img src={previewUrl} alt="Preview" className="max-h-48 rounded-md object-contain mx-auto" />
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileText className="h-8 w-8" />
                    <span className="text-sm">PDF selecionado</span>
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={resetForm}
                >
                  Remover
                </Button>
              </div>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleUpload}
              disabled={!selectedEmployee || !previewFile || uploading}
            >
              {uploading ? "Salvando..." : "Salvar Atestado"}
            </Button>
          </CardContent>
        </Card>

        {/* Filter */}
        <div className="flex gap-2">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterYear} onValueChange={setFilterYear}>
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {MONTHS[Number(filterMonth)]} {filterYear} — {certificates?.length || 0} atestado(s)
          </h2>

          {isLoading ? (
            <div className="py-8 text-center text-muted-foreground">Carregando...</div>
          ) : !certificates?.length ? (
            <div className="py-8 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p>Nenhum atestado neste período</p>
            </div>
          ) : (
            certificates.map((cert) => (
              <Card key={cert.id}>
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {cert.employee_name || employeeName(cert.employee_id)}
                    </p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(cert.certificate_date + "T12:00:00"), "dd/MM/yyyy")}
                      {cert.notes && ` • ${cert.notes}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => window.open(api.certificates.fileUrl(cert.file_path), "_blank")}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: cert.id })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </main>
    </div>
  );
};

export default CertificatesPage;
