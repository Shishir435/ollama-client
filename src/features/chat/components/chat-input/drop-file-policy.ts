export interface DropFilePolicyResult {
  acceptedFiles: File[]
  rejectedImages: File[]
}

export const splitDropFiles = (files: File[]): DropFilePolicyResult => {
  const acceptedFiles: File[] = []
  const rejectedImages: File[] = []

  files.forEach((file) => {
    if (file.type.startsWith("image/")) {
      rejectedImages.push(file)
      return
    }

    acceptedFiles.push(file)
  })

  return { acceptedFiles, rejectedImages }
}

export const hasDraggedImage = (items: DataTransferItemList) =>
  Array.from(items).some((item) => item.type.startsWith("image/"))

export const fileListFromFiles = (files: File[]) => {
  const dataTransfer = new DataTransfer()
  files.forEach((file) => {
    dataTransfer.items.add(file)
  })
  return dataTransfer.files
}
