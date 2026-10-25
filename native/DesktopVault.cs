using System;
using System.Linq;
using System.Windows.Forms;

namespace NZIP {
    public sealed partial class DesktopWindow {
        internal string PasswordManager(bool choose=false){
            using(var vault=new PasswordVault(backend.Profile))using(var dialog=new EditorDialog(I18n.T("密码管理器"),490)){
                dialog.Note(I18n.T("密码使用 Windows 当前用户加密保存，仅在本机当前账户下读取。不会自动尝试或发送密码；重装系统或换账户前请保留自己的密码记录。"));
                var list=new ListBox{Width=525,Height=150,Name="vault-list"};dialog.Body.Controls.Add(list);var label=dialog.TextField(I18n.T("名称"),"","vault-label");var secret=dialog.TextField(I18n.T("密码"),"","vault-password",true);
                var actions=new FlowLayoutPanel{Width=525,Height=35};var add=new Button{Text=I18n.T("保存新密码"),Width=130,Name="vault-add"};var remove=new Button{Text=I18n.T("删除所选"),Width=130,Name="vault-remove"};actions.Controls.AddRange(new Control[]{add,remove});dialog.Body.Controls.Add(actions);
                Action refresh=()=>{list.Items.Clear();foreach(var item in vault.Labels())list.Items.Add(new VaultLabel{Id=Json.Str(item,"id"),Label=Json.Str(item,"label")});};refresh();
                add.Click+=(s,e)=>{try{vault.Add(label.Text,secret.Text);secret.Clear();label.Clear();refresh();}catch(Exception error){Error(error);}};
                remove.Click+=(s,e)=>{var selected=list.SelectedItem as VaultLabel;if(selected==null)return;if(MessageBox.Show(dialog,I18n.T("删除所选密码？"),"NZIP",MessageBoxButtons.YesNo)==DialogResult.Yes){vault.Remove(selected.Id);refresh();}};
                string answer=null;dialog.Confirm.Text=choose?I18n.T("使用所选密码"):I18n.T("关闭");dialog.Confirm.Click+=(s,e)=>{if(choose){var selected=list.SelectedItem as VaultLabel;if(selected==null)return;answer=vault.Get(selected.Id);}secret.Clear();dialog.DialogResult=DialogResult.OK;};dialog.ShowDialog(this);secret.Clear();return answer;
            }
        }
        sealed class VaultLabel {public string Id,Label;public override string ToString(){return Label;}}
        void AddVaultPicker(EditorDialog dialog,TextBox field){var button=new Button{Text=I18n.T("从密码库选择…"),Width=170,Name="vault-pick"};button.Click+=(s,e)=>{var value=PasswordManager(true);if(value!=null)field.Text=value;};dialog.Body.Controls.Add(button);}
    }
}
